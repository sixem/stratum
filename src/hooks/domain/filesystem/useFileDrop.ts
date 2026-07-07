// Handles native drag-and-drop into the file view and tab targets.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import {
  getDropTargetFromPoint,
  makeDebug,
  normalizePath,
} from "@/lib";
import { usePromptStore, useTransferStore } from "@/modules";
import type { DropTarget } from "@/lib";
import {
  planDropTransfer,
  resolveDropTransferConflicts,
} from "./dropTransferPlanning";
import type { UndoMoveEntry } from "./fileManagerUndo";
import { runDropTransfer } from "./runDropTransfer";
import { useTabDropSubmenu } from "./useTabDropSubmenu";

type UseFileDropOptions = {
  currentPath: string;
  onRefresh?: () => void;
  onRecordMoveUndo?: (entries: UndoMoveEntry[]) => void;
  onTransferInFlightChange?: (active: boolean) => void;
  enabled?: boolean;
  enableTabDropSubfolders?: boolean;
};

type ClientPoint = {
  x: number;
  y: number;
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

const getClientPoint = (event: DragDropEvent): ClientPoint | null => {
  if (!("position" in event)) {
    return null;
  }
  const scale = window.devicePixelRatio || 1;
  return {
    x: event.position.x / scale,
    y: event.position.y / scale,
  };
};


export const useFileDrop = ({
  currentPath,
  onRefresh,
  onRecordMoveUndo,
  onTransferInFlightChange,
  enabled = true,
  enableTabDropSubfolders = false,
}: UseFileDropOptions) => {
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [dropTargetTabId, setDropTargetTabId] = useState<string | null>(null);
  const [dragPoint, setDragPoint] = useState<ClientPoint | null>(null);
  // Track source entries that are currently being moved or copied so the
  // explorer can show immediate busy feedback before backend progress arrives.
  const [pendingTransferPaths, setPendingTransferPaths] = useState<Set<string>>(new Set());
  const currentPathRef = useRef(currentPath);
  // Cache the normalized path to keep drop comparisons cheap.
  const currentPathKeyRef = useRef(normalizePath(currentPath));
  const refreshRef = useRef(onRefresh);
  const inFlightRef = useRef(false);
  const lastHoverRef = useRef<string | null>(null);
  const promptStore = useMemo(() => usePromptStore.getState(), []);
  const registerTransferJob = useTransferStore((state) => state.registerJob);
  const updateTransferLabel = useTransferStore((state) => state.updateJobLabel);
  const recordTransferJobOutcome = useTransferStore((state) => state.recordJobOutcome);
  const {
    submenu: tabDropSubmenu,
    updateTarget: updateTabDropSubmenuTarget,
    closeSubmenu: closeTabDropSubmenu,
  } = useTabDropSubmenu({
    enabled: enabled && enableTabDropSubfolders,
  });

  const setDropTarget = useCallback((target: DropTarget | null) => {
    if (!target) {
      setDropTargetPath(null);
      setDropTargetTabId(null);
      updateTabDropSubmenuTarget(null);
      return;
    }
    if (target.kind === "tab") {
      setDropTargetTabId((prev) => (prev === target.tabId ? prev : target.tabId ?? null));
      setDropTargetPath(null);
      updateTabDropSubmenuTarget(target);
      return;
    }
    if (target.kind === "tab-subfolder") {
      setDropTargetPath((prev) => (prev === target.path ? prev : target.path));
      setDropTargetTabId((prev) => (prev === target.tabId ? prev : target.tabId ?? null));
      updateTabDropSubmenuTarget(target);
      return;
    }
    setDropTargetPath((prev) => (prev === target.path ? prev : target.path));
    setDropTargetTabId(null);
    updateTabDropSubmenuTarget(target);
  }, [updateTabDropSubmenuTarget]);

  const clearDragState = useCallback(() => {
    lastHoverRef.current = null;
    setDragPoint(null);
    setDropTarget(null);
    closeTabDropSubmenu();
  }, [closeTabDropSubmenu, setDropTarget]);

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
      const plan = planDropTransfer(paths, targetPath, currentPathRef.current);
      if (!plan) return;

      if (log.enabled) {
        log("drop-handle: count=%d destination=%s", plan.items.length, plan.destination);
      }

      const resolvedPlan = await resolveDropTransferConflicts(plan, promptStore);
      if (!resolvedPlan) return;

      const pendingPathKeys = new Set(
        resolvedPlan.items
          .map((item) => normalizePath(item.candidate.path))
          .filter((value): value is string => Boolean(value)),
      );

      inFlightRef.current = true;
      onTransferInFlightChange?.(true);
      if (pendingPathKeys.size > 0) {
        setPendingTransferPaths((previous) => {
          if (previous.size === 0) return new Set(pendingPathKeys);
          const merged = new Set(previous);
          pendingPathKeys.forEach((pathKey) => merged.add(pathKey));
          return merged;
        });
      }
      try {
        await runDropTransfer({
          plan: resolvedPlan,
          promptStore,
          currentPathKey: currentPathKeyRef.current,
          onRefresh: refreshRef.current,
          onRecordMoveUndo,
          transferStore: {
            registerTransferJob,
            updateTransferLabel,
            recordTransferJobOutcome,
          },
        });
      } finally {
        if (pendingPathKeys.size > 0) {
          setPendingTransferPaths((previous) => {
            if (previous.size === 0) return previous;
            const next = new Set(previous);
            pendingPathKeys.forEach((pathKey) => next.delete(pathKey));
            return next;
          });
        }
        inFlightRef.current = false;
        onTransferInFlightChange?.(false);
      }
    },
    [
      onRecordMoveUndo,
      onTransferInFlightChange,
      promptStore,
      recordTransferJobOutcome,
      registerTransferJob,
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
          setDragPoint(getClientPoint(payload));
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
          clearDragState();
          return;
        }
        if (payload.type === "drop") {
          const target = getDropTarget(payload);
          if (log.enabled) {
            log("drop: count=%d target=%s", payload.paths.length, target?.path ?? "none");
            log("drop: paths=%o", payload.paths);
            log("drop: payload=%o", payload);
          }
          clearDragState();
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
  }, [clearDragState, enabled, performDrop, setDropTarget]);

  return {
    dropTargetPath,
    dropTargetTabId,
    dragPoint,
    pendingTransferPaths,
    tabDropSubmenu,
    performDrop,
    setDropTarget,
    clearDragState,
  };
};
