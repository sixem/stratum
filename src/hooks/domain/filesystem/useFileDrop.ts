// Handles native drag-and-drop into the file view and tab targets.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { statEntries, transferEntries } from "@/api";
import {
  buildDropCandidate,
  formatFailures,
  getDropTargetFromPoint,
  getParentPath,
  joinPath,
  makeDebug,
  normalizeDropPath,
  normalizePath,
} from "@/lib";
import { usePromptStore, useTransferStore } from "@/modules";
import type { DropCandidate, DropTarget } from "@/lib";

type UseFileDropOptions = {
  currentPath: string;
  onRefresh?: () => void;
  enabled?: boolean;
};

const log = makeDebug("drop");

const getDropTarget = (event: DragDropEvent): DropTarget | null => {
  if (!("position" in event)) {
    return null;
  }
  const scale = window.devicePixelRatio || 1;
  const x = event.position.x / scale;
  const y = event.position.y / scale;
  return getDropTargetFromPoint(x, y);
};


export const useFileDrop = ({
  currentPath,
  onRefresh,
  enabled = true,
}: UseFileDropOptions) => {
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [dropTargetTabId, setDropTargetTabId] = useState<string | null>(null);
  const currentPathRef = useRef(currentPath);
  // Cache the normalized path to keep drop comparisons cheap.
  const currentPathKeyRef = useRef(normalizePath(currentPath));
  const refreshRef = useRef(onRefresh);
  const inFlightRef = useRef(false);
  const lastHoverRef = useRef<string | null>(null);
  const promptStore = useMemo(() => usePromptStore.getState(), []);
  const startTransferJob = useTransferStore((state) => state.startJob);
  const updateTransferLabel = useTransferStore((state) => state.updateLabel);
  const completeTransferJob = useTransferStore((state) => state.completeJob);
  const failTransferJob = useTransferStore((state) => state.failJob);

  const setDropTarget = useCallback((target: DropTarget | null) => {
    if (!target) {
      setDropTargetPath(null);
      setDropTargetTabId(null);
      return;
    }
    if (target.kind === "tab") {
      setDropTargetTabId((prev) => (prev === target.tabId ? prev : target.tabId ?? null));
      setDropTargetPath(null);
      return;
    }
    setDropTargetPath((prev) => (prev === target.path ? prev : target.path));
    setDropTargetTabId(null);
  }, []);

  useEffect(() => {
    currentPathRef.current = currentPath;
    currentPathKeyRef.current = normalizePath(currentPath);
  }, [currentPath]);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  const performDrop = useCallback(
    async (paths: string[], targetPath: string | null) => {
      if (inFlightRef.current) return;
      const trimmed = Array.from(
        new Set(paths.map((path) => path.trim()).filter(Boolean)),
      );
      if (trimmed.length === 0) return;
      const fallback = currentPathRef.current.trim();
      const destination = (targetPath ?? fallback).trim();
      if (!destination) return;
      const destinationKey = normalizeDropPath(destination);
      if (!destinationKey) return;
      // Ignore drops that resolve to the same directory or folder itself.
      const candidates = trimmed
        .map((path) => buildDropCandidate(path, destinationKey))
        .filter((candidate): candidate is DropCandidate => Boolean(candidate));
      const meaningful = candidates.filter((candidate) => !candidate.isSameDirectory);
      if (meaningful.length === 0) return;
      if (log.enabled) {
        log(
          "drop-handle: count=%d destination=%s",
          meaningful.length,
          destination,
        );
      }

      // Build the destination paths so we can warn about overwrites before transfer.
      const destinationPaths = meaningful
        .map((candidate) => ({
          name: candidate.name,
          destination: joinPath(destination, candidate.name),
        }))
        .filter((candidate) => candidate.name && candidate.destination);

      const existingNames: string[] = [];
      if (destinationPaths.length > 0) {
        const metas = await statEntries(destinationPaths.map((item) => item.destination));
        metas.forEach((meta, index) => {
          const exists = meta.size != null || meta.modified != null;
          if (exists) {
            existingNames.push(destinationPaths[index]?.name ?? "");
          }
        });
      }

      let overwrite = false;
      if (existingNames.length > 0) {
        const samples = existingNames.slice(0, 4);
        const suffix =
          existingNames.length > samples.length
            ? `\n...and ${existingNames.length - samples.length} more`
            : "";
        const message = `Overwrite ${existingNames.length} item${
          existingNames.length === 1 ? "" : "s"
        } in ${destination}?\n\n${samples.join("\n")}${suffix}`;

        const confirmed = await new Promise<boolean>((resolve) => {
          promptStore.showPrompt({
            title: "Overwrite items?",
            content: message,
            confirmLabel: "Overwrite",
            cancelLabel: "Cancel",
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!confirmed) return;
        overwrite = true;
      }

      const job = startTransferJob({
        label: "Transfer",
        total: meaningful.length,
        items: meaningful.map((candidate) => candidate.path),
      });
      inFlightRef.current = true;
      try {
        // Use auto mode so same-drive drops move and cross-drive drops copy.
        const report = await transferEntries(
          meaningful.map((candidate) => candidate.path),
          destination,
          { mode: "auto", overwrite },
          job.id,
        );
        const label =
          report.moved > 0 && report.copied > 0
            ? "Transfer"
            : report.moved > 0
              ? "Move"
              : "Copy";
        updateTransferLabel(job.id, label);
        completeTransferJob(job.id, {
          copied: report.copied,
          moved: report.moved,
          skipped: report.skipped,
          failures: report.failures.length,
        });
        if (report.failures.length > 0) {
          promptStore.showPrompt({
            title: `${label} completed with issues`,
            content: formatFailures(report.failures),
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        const movedCount = report.moved ?? 0;
        const copiedCount = report.copied ?? 0;
        const touchedCurrentDestination =
          destinationKey === currentPathKeyRef.current && (movedCount > 0 || copiedCount > 0);
        const touchedCurrentSource =
          movedCount > 0 &&
          meaningful.some((candidate) => {
            const parent = getParentPath(candidate.path) ?? "";
            return normalizePath(parent) === currentPathKeyRef.current;
          });
        if (touchedCurrentDestination || touchedCurrentSource) {
          refreshRef.current?.();
        }
      } catch (error) {
        failTransferJob(job.id);
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Failed to transfer dropped items.";
        promptStore.showPrompt({
          title: "Transfer failed",
          content: message,
          confirmLabel: "OK",
          cancelLabel: null,
        });
      } finally {
        inFlightRef.current = false;
      }
    },
    [
      completeTransferJob,
      failTransferJob,
      promptStore,
      startTransferJob,
      updateTransferLabel,
    ],
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unlisten: (() => void) | null = null;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!active) return;
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          const target = getDropTarget(payload);
          const key = target ? `${target.kind}:${target.path}` : "none";
          if (lastHoverRef.current !== key && log.enabled) {
            log("hover: type=%s target=%s", payload.type, key);
          }
          lastHoverRef.current = key;
          setDropTarget(target);
          return;
        }
        if (payload.type === "leave") {
          if (log.enabled) {
            log("leave");
          }
          lastHoverRef.current = null;
          setDropTarget(null);
          return;
        }
        if (payload.type === "drop") {
          const target = getDropTarget(payload);
          if (log.enabled) {
            log("drop: count=%d target=%s", payload.paths.length, target?.path ?? "none");
            log("drop: paths=%o", payload.paths);
            log("drop: payload=%o", payload);
          }
          lastHoverRef.current = null;
          setDropTarget(null);
          void performDrop(payload.paths, target?.path ?? null);
        }
      })
      .then((stop) => {
        unlisten = stop;
      })
      .catch(() => {
        // Ignore drag/drop setup failures.
      });

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [enabled, performDrop, setDropTarget]);

  return { dropTargetPath, dropTargetTabId, performDrop, setDropTarget };
};
