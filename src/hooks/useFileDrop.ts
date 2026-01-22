// Handles native drag-and-drop copy into the current view.
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { copyEntries } from "@/api";
import { formatFailures, getParentPath, normalizePath } from "@/lib";
import { usePromptStore } from "@/modules";

type UseFileDropOptions = {
  currentPath: string;
  onRefresh?: () => void;
  enabled?: boolean;
};

const getDropTarget = (event: DragDropEvent): string | null => {
  if (!("position" in event)) {
    return null;
  }
  const scale = window.devicePixelRatio || 1;
  const x = event.position.x / scale;
  const y = event.position.y / scale;
  const element = document.elementFromPoint(x, y) as HTMLElement | null;
  const target = element?.closest<HTMLElement>("[data-is-dir=\"true\"][data-path]");
  return target?.dataset.path ?? null;
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
  return trimmed;
};

const normalizeDropPath = (path: string) => {
  const cleaned = sanitizeDropPath(path);
  if (!cleaned) return "";
  return normalizePath(cleaned);
};

const getDropParentKey = (path: string) => {
  const cleaned = sanitizeDropPath(path);
  if (!cleaned) return "";
  const parent = getParentPath(cleaned);
  if (!parent) return "";
  return normalizePath(parent);
};

export const useFileDrop = ({
  currentPath,
  onRefresh,
  enabled = true,
}: UseFileDropOptions) => {
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const currentPathRef = useRef(currentPath);
  // Cache the normalized path to keep drop comparisons cheap.
  const currentPathKeyRef = useRef(normalizePath(currentPath));
  const refreshRef = useRef(onRefresh);
  const inFlightRef = useRef(false);
  const promptStore = useMemo(() => usePromptStore.getState(), []);

  useEffect(() => {
    currentPathRef.current = currentPath;
    currentPathKeyRef.current = normalizePath(currentPath);
  }, [currentPath]);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unlisten: (() => void) | null = null;

    const handleDrop = async (paths: string[], targetPath: string | null) => {
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
      const meaningful = trimmed.filter((path) => {
        const normalized = normalizeDropPath(path);
        if (!normalized) return false;
        if (normalized === destinationKey) {
          return false;
        }
        const parentKey = getDropParentKey(path);
        if (!parentKey) return true;
        return parentKey !== destinationKey;
      });
      if (meaningful.length === 0) return;

      inFlightRef.current = true;
      try {
        const report = await copyEntries(meaningful, destination);
        if (report.failures.length > 0) {
          promptStore.showPrompt({
            title: "Copy completed with issues",
            content: formatFailures(report.failures),
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        if (destinationKey === currentPathKeyRef.current) {
          refreshRef.current?.();
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Failed to copy dropped items.";
        promptStore.showPrompt({
          title: "Copy failed",
          content: message,
          confirmLabel: "OK",
          cancelLabel: null,
        });
      } finally {
        inFlightRef.current = false;
      }
    };

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!active) return;
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          const target = getDropTarget(payload);
          setDropTargetPath((prev) => (prev === target ? prev : target));
          return;
        }
        if (payload.type === "leave") {
          setDropTargetPath(null);
          return;
        }
        if (payload.type === "drop") {
          const target = getDropTarget(payload);
          setDropTargetPath(null);
          void handleDrop(payload.paths, target);
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
  }, [enabled, promptStore]);

  return { dropTargetPath };
};
