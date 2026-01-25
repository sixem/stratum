// Handles native drag-and-drop into the file view and tab targets.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { statEntries, transferEntries } from "@/api";
import {
  formatFailures,
  getDropTargetFromPoint,
  getParentPath,
  makeDebug,
  normalizePath,
} from "@/lib";
import { usePromptStore } from "@/modules";
import type { DropTarget } from "@/lib";

type UseFileDropOptions = {
  currentPath: string;
  onRefresh?: () => void;
  enabled?: boolean;
};

type DropCandidate = {
  path: string;
  name: string;
  isSameDirectory: boolean;
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

// Normalize drag/drop paths that may include URL or extended-length prefixes.
const sanitizeDropPath = (path: string) => {
  let trimmed = path.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("file://")) {
    trimmed = trimmed.replace(/^file:\/*/i, "");
    if (trimmed.toLowerCase().startsWith("localhost/")) {
      trimmed = trimmed.slice("localhost/".length);
    }
    trimmed = trimmed.replace(/^\/+/, "");
    try {
      trimmed = decodeURIComponent(trimmed);
    } catch {
      // Ignore decode errors; we'll compare the raw value.
    }
  }
  if (trimmed.startsWith("\\\\?\\")) {
    trimmed = trimmed.slice(4);
  } else if (trimmed.startsWith("//?/")) {
    trimmed = trimmed.slice(4);
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("unc\\")) {
    trimmed = `\\\\${trimmed.slice(4)}`;
  } else if (lower.startsWith("unc/")) {
    trimmed = `\\\\${trimmed.slice(4)}`;
  }
  return trimmed;
};

const normalizeDropPath = (path: string) => {
  const cleaned = sanitizeDropPath(path);
  if (!cleaned) return "";
  return normalizePath(cleaned);
};

const getNormalizedParentKey = (normalizedPath: string) => {
  if (!normalizedPath) return "";
  const parent = getParentPath(normalizedPath);
  if (!parent) return "";
  return normalizePath(parent);
};

const getPathName = (path: string) => {
  const trimmed = sanitizeDropPath(path).replace(/[\\/]+$/, "");
  if (!trimmed) return "";
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
};

const joinPath = (base: string, name: string) => {
  const trimmed = base.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return name;
  return `${trimmed}\\${name}`;
};

// Normalize drop paths once so we can skip no-op drops locally.
const buildDropCandidate = (
  path: string,
  destinationKey: string,
): DropCandidate | null => {
  const cleaned = sanitizeDropPath(path);
  if (!cleaned) return null;
  const normalized = normalizePath(cleaned);
  if (!normalized) return null;
  const parentKey = getNormalizedParentKey(normalized);
  const isSameDirectory =
    normalized === destinationKey ||
    (parentKey !== "" && parentKey === destinationKey);
  return {
    path: cleaned,
    name: getPathName(cleaned),
    isSameDirectory,
  };
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

      inFlightRef.current = true;
      try {
        // Use auto mode so same-drive drops move and cross-drive drops copy.
        const report = await transferEntries(
          meaningful.map((candidate) => candidate.path),
          destination,
          { mode: "auto", overwrite },
        );
        if (report.failures.length > 0) {
          const label =
            report.moved > 0 && report.copied > 0
              ? "Transfer"
              : report.moved > 0
                ? "Move"
                : "Copy";
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
    [promptStore],
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
