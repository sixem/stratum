// Handles native drag-and-drop into the file view and tab targets.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { fileDropListenerReady, releaseDropStage } from "@/api";
import type { TransferMode } from "@/types";
import { FileDropQueue } from "./nativeFileDrag";
import type { NativeFileDrag } from "./nativeFileDrag";
import {
  getDropTargetFromPoint,
  makeDebug,
  normalizeDropPath,
  toMessage,
} from "@/lib";
import { usePromptStore, useTransferStore } from "@/modules";
import { captureMoveHistoryWorkspace } from "@/modules/recentMoveStore";
import type { PromptConfig } from "@/modules";
import type { DropTarget } from "@/lib";
import { createTabLocationHover, getTabLocationDropTarget, openDroppedLocation } from "@/lib/tabLocationDrop";
import {
  planDropTransfer,
  resolveDropTransferConflicts,
} from "./dropTransferPlanning";
import type { ResolvedDropTransferPlan } from "./dropTransferPlanning";
import type { UndoMoveEntry } from "./fileManagerUndo";
import { runDropTransfer } from "./runDropTransfer";
import { useTabDropSubmenu } from "./useTabDropSubmenu";
import type { BeginFileActivity } from "./useFileActivity";

type UseFileDropOptions = {
  beginFileActivity: BeginFileActivity;
  currentPath: string;
  onRefresh?: () => void;
  onRecordMoveUndo?: (entries: UndoMoveEntry[]) => void;
  onTransferInFlightChange?: (active: boolean) => void;
  enabled?: boolean;
  enableTabDropSubfolders?: boolean;
  enableTabDropParentFolder?: boolean;
};

type ClientPoint = {
  x: number;
  y: number;
};

const log = makeDebug("drop");

const getClientPoint = (position: ClientPoint): ClientPoint => {
  const scale = window.devicePixelRatio || 1;
  return {
    x: position.x / scale,
    y: position.y / scale,
  };
};


export const useFileDrop = ({
  beginFileActivity,
  currentPath,
  onRefresh,
  onRecordMoveUndo,
  onTransferInFlightChange,
  enabled = true,
  enableTabDropSubfolders = false,
  enableTabDropParentFolder = false,
}: UseFileDropOptions) => {
  const tabDropMenuEnabled = enabled && (enableTabDropSubfolders || enableTabDropParentFolder);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [dropTargetTabId, setDropTargetTabId] = useState<string | null>(null);
  const [dragPoint, setDragPoint] = useState<ClientPoint | null>(null);
  const [hoveredPane, setHoveredPane] = useState<DropTarget["pane"]>();
  const [backgroundHovered, setBackgroundHovered] = useState(false);
  // Cache the normalized path to keep drop comparisons cheap.
  const currentPathKeyRef = useRef(normalizeDropPath(currentPath));
  const refreshRef = useRef(onRefresh);
  const activeTransfers = useRef(0);
  const [dropQueue] = useState(() => new FileDropQueue());
  const [highlightTabStrip] = useState(createTabLocationHover);
  const promptStore = useMemo(() => usePromptStore.getState(), []);
  const registerTransferJob = useTransferStore((state) => state.registerFileJob);
  const updateTransferLabel = useTransferStore((state) => state.updateJobLabel);
  const recordTransferJobOutcome = useTransferStore((state) => state.recordJobOutcome);
  const {
    submenu: tabDropSubmenu,
    updateTarget: updateTabDropSubmenuTarget,
    closeSubmenu: closeTabDropSubmenu,
  } = useTabDropSubmenu({
    enabled: tabDropMenuEnabled,
    includeSubfolders: enableTabDropSubfolders,
    includeParent: enableTabDropParentFolder,
  });

  const setDropTarget = useCallback((target: DropTarget | null) => {
    setHoveredPane(target?.pane);
    setBackgroundHovered(target?.kind === "pane");
    if (!target || target.kind === "pane") {
      setDropTargetPath(null);
      setDropTargetTabId(null);
      updateTabDropSubmenuTarget(null);
      return;
    }
    if (target.kind === "tab" || target.kind === "tab-submenu") {
      setDropTargetTabId((prev) => (prev === target.tabId ? prev : target.tabId ?? null));
      setDropTargetPath(null);
      updateTabDropSubmenuTarget(target);
      return;
    }
    if (target.kind === "tab-destination") {
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
    highlightTabStrip(null);
    setDragPoint(null);
    setDropTarget(null);
    closeTabDropSubmenu();
  }, [closeTabDropSubmenu, highlightTabStrip, setDropTarget]);

  useLayoutEffect(() => {
    currentPathKeyRef.current = normalizeDropPath(currentPath);
  }, [currentPath]);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  const executeDrop = useCallback(
    async (plan: ResolvedDropTransferPlan, dropStage?: number, moveHistoryWorkspace?: string | null) => {
      if (log.enabled) {
        log("drop-handle: count=%d destination=%s", plan.items.length, plan.destination);
      }

      activeTransfers.current++;
      if (activeTransfers.current === 1) onTransferInFlightChange?.(true);
      try {
        await runDropTransfer({
          plan,
          dropStage,
          moveHistoryWorkspace,
          promptStore: {
            // A finished transfer can report issues while a later drop is
            // waiting for an overwrite decision.
            showPrompt: (prompt: PromptConfig) => {
              void dropQueue.add(() => promptStore.showPrompt(prompt));
            },
          },
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
        activeTransfers.current--;
        if (activeTransfers.current === 0) onTransferInFlightChange?.(false);
      }
    },
    [
      dropQueue,
      onRecordMoveUndo,
      onTransferInFlightChange,
      promptStore,
      recordTransferJobOutcome,
      registerTransferJob,
      updateTransferLabel,
    ],
  );

  const dropErrorQueued = useRef(false);
  const queueDropError = useCallback(async (message: string) => {
    if (dropErrorQueued.current) return;
    dropErrorQueued.current = true;
    // A pending conflict prompt holds the staged files until it resolves.
    // Keep a later drop error from replacing that prompt.
    await dropQueue.add(async () => {
      dropErrorQueued.current = false;
      promptStore.showPrompt({ title: "Drop failed", content: message, confirmLabel: "OK", cancelLabel: null });
    });
  }, [dropQueue, promptStore]);

  const performDrop = useCallback(async (
    paths: string[], target: string, mode: TransferMode, dropStage: number | undefined,
    moveHistoryWorkspace: ReturnType<typeof captureMoveHistoryWorkspace>,
  ) => {
    if (dropStage != null && /^[\s\u0085]|[\s\u0085]$/u.test(target)) {
      await queueDropError("Choose a destination folder whose name does not end in whitespace.");
      return;
    }
    // Capture the destination on release, even when an earlier drop has a prompt open.
    const plan = planDropTransfer(paths, target, mode);
    if (!plan) return;
    const finishWaiting = dropQueue.busy
      ? beginFileActivity(`Drop queued for ${plan.destination}`) : null;
    try {
      const resolvedPlan = await dropQueue.add(() => {
        finishWaiting?.();
        return resolveDropTransferConflicts(plan, promptStore);
      });
      if (resolvedPlan) await executeDrop(resolvedPlan, dropStage, moveHistoryWorkspace);
    } catch (error) {
      await queueDropError(toMessage(error, "Unable to prepare the dropped files."));
    }
  }, [beginFileActivity, dropQueue, executeDrop, promptStore, queueDropError]);

  const pendingDrops = useRef(new Map<number, {
    target: string;
    workspace: ReturnType<typeof captureMoveHistoryWorkspace>;
    finish: () => void;
  }>());
  const onDragEvent = useRef<(event: NativeFileDrag) => void>(() => {});
  useLayoutEffect(() => {
    onDragEvent.current = async (payload) => {
      const pendingId = payload.type === "drop" || payload.type === "error" ? payload.pendingDrop : null;
      const pending = pendingId == null ? undefined : pendingDrops.current.get(pendingId);
      if (pendingId != null) pendingDrops.current.delete(pendingId);
      pending?.finish();
      if (payload.type === "error") {
        if (pendingId == null) clearDragState();
        if (pendingId == null || pending) await queueDropError(payload.message);
        return;
      }
      if (payload.type === "leave") {
        clearDragState();
        return;
      }
      const point = getClientPoint(payload.position);
      if (payload.type === "receiving") {
        const target = getDropTargetFromPoint(point.x, point.y);
        clearDragState();
        if (target && target.kind !== "tab-submenu") {
          pendingDrops.current.set(payload.pendingDrop, {
            target: target.path,
            workspace: captureMoveHistoryWorkspace(),
            finish: beginFileActivity("Receiving dropped files"),
          });
        }
        return;
      }
      const strip = payload.canOpenFolderTab ? getTabLocationDropTarget(point.x, point.y, false) : null;
      if (payload.type === "drop") {
        try {
          if (pendingId != null) {
            if (pending) {
              await performDrop(payload.paths, pending.target, payload.mode, payload.stage ?? undefined, pending.workspace);
            }
            return;
          }
          const target = strip ? null : getDropTargetFromPoint(point.x, point.y);
          clearDragState();
          if (strip && payload.paths.length === 1 && payload.stage == null) {
            openDroppedLocation(strip, payload.paths[0]);
            return;
          }
          if (target && target.kind !== "tab-submenu") {
            await performDrop(payload.paths, target.path, payload.mode, payload.stage ?? undefined, captureMoveHistoryWorkspace());
          }
        } finally {
          if (payload.stage != null) await releaseDropStage(payload.stage).catch((error) => log("release drop stage: %o", error));
        }
        return;
      }
      const stripChanged = highlightTabStrip(strip);
      if (strip) {
        if (stripChanged) {
          setDragPoint(null);
          setDropTarget(null);
          closeTabDropSubmenu();
        }
        return;
      }
      const target = getDropTargetFromPoint(point.x, point.y);
      // Only the optional tab submenu uses coordinates to scroll. Ordinary
      // file drags need a render when the hovered destination changes.
      if (tabDropMenuEnabled) {
        setDragPoint((previous) => previous?.x === point.x && previous.y === point.y ? previous : point);
      }
      setDropTarget(target);
    };
  }, [beginFileActivity, clearDragState, closeTabDropSubmenu, highlightTabStrip, performDrop, queueDropError, setDropTarget, tabDropMenuEnabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    const receives = pendingDrops.current;

    getCurrentWebview().listen<NativeFileDrag>("stratum-file-drag", ({ payload }) => {
      if (active) onDragEvent.current(payload);
    }).then((stop) => {
      if (!active) return stop();
      unlisten = stop;
      return fileDropListenerReady();
    }).catch((error) => log("drop listener failed: %o", error));
    return () => {
      active = false;
      highlightTabStrip(null);
      receives.forEach(({ finish }) => finish());
      receives.clear();
      unlisten?.();
    };
  }, [enabled, highlightTabStrip]);

  return {
    hoveredPane,
    backgroundHovered,
    dropTargetPath,
    dropTargetTabId,
    dragPoint,
    tabDropSubmenu,
    setDropTarget,
    clearDragState,
  };
};
