// Manages quick preview mode for single-media selections.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { FileEntry } from "@/types";
import { getFileKind, isEditableElement } from "@/lib";
import { buildKeybindFromEvent, normalizeKeybind } from "@/modules";

type UseQuickPreviewOptions = {
  entryByPath: Map<string, FileEntry>;
  mainRef: RefObject<HTMLElement | null>;
  previewKeybind: string;
  settingsOpen: boolean;
  contextMenuOpen: boolean;
  promptOpen: boolean;
  loading: boolean;
};

const PREVIEW_HOLD_DELAY_MS = 220;
const PREVIEW_HOLD_THRESHOLD_MS = 220;

export const useQuickPreview = ({
  entryByPath,
  mainRef,
  previewKeybind,
  settingsOpen,
  contextMenuOpen,
  promptOpen,
  loading,
}: UseQuickPreviewOptions) => {
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const previewPathRef = useRef<string | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const holdStateRef = useRef<{
    timer: number | null;
    active: boolean;
    holdTriggered: boolean;
    openedByHold: boolean;
    path: string | null;
    source: "mouse" | "key" | null;
    keyCode: string | null;
    startedAt: number | null;
    preExistingPath: string | null;
    immediateOpen: boolean;
  }>({
    timer: null,
    active: false,
    holdTriggered: false,
    openedByHold: false,
    path: null,
    source: null,
    keyCode: null,
    startedAt: null,
    preExistingPath: null,
    immediateOpen: false,
  });

  const previewBinding = useMemo(
    () => normalizeKeybind(previewKeybind ?? ""),
    [previewKeybind],
  );
  const previewUsesMouse = previewBinding === "MouseMiddle";

  const canTriggerPreview = useCallback(() => {
    if (settingsOpen || contextMenuOpen || promptOpen) return false;
    if (loading) return false;
    const active = document.activeElement;
    if (isEditableElement(active)) return false;
    const main = mainRef.current;
    if (!main) return false;

    const hasMainFocus = Boolean(active && main.contains(active));
    const isRootFocus =
      !active || active === document.body || active === document.documentElement;

    // Quick preview is a "view-level" action. If focus is currently on something like the
    // tabs bar, we still want the preview keybind to work. Bring focus back to the main
    // view so follow-up navigation stays predictable.
    if (!hasMainFocus && !isRootFocus) {
      main.focus({ preventScroll: true });
    }

    return true;
  }, [contextMenuOpen, loading, mainRef, promptOpen, settingsOpen]);

  const openPreview = useCallback((path: string) => {
    setPreviewPath(path);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewPath(null);
  }, []);

  useEffect(() => {
    previewPathRef.current = previewPath;
  }, [previewPath]);

  useEffect(() => {
    // Pointer tracking is only needed for keyboard-triggered previews, because we need to
    // resolve "the hovered item" when the preview keybind fires.
    if (previewUsesMouse) return;
    const updatePointer = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", updatePointer, { passive: true });
    window.addEventListener("pointerdown", updatePointer, { passive: true });
    return () => {
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("pointerdown", updatePointer);
    };
  }, [previewUsesMouse]);

  const resolvePreviewPath = useCallback(
    (path: string | null) => {
      if (!path) return null;
      const entry = entryByPath.get(path);
      if (!entry || entry.isDir) return null;
      const kind = getFileKind(entry.name);
      if (kind !== "image" && kind !== "video") return null;
      return entry.path;
    },
    [entryByPath],
  );

  const getHoveredPreviewPath = useCallback(() => {
    const pointer = pointerRef.current;
    if (!pointer) return null;
    const element = document.elementFromPoint(pointer.x, pointer.y) as HTMLElement | null;
    const entry = element?.closest<HTMLElement>("[data-path]");
    if (!entry) return null;
    if (entry.dataset.selectable === "false") return null;
    return resolvePreviewPath(entry.dataset.path ?? null);
  }, [resolvePreviewPath]);

  const clearHoldTimer = useCallback(() => {
    const state = holdStateRef.current;
    if (state.timer != null) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
  }, []);

  const resetHoldState = useCallback(() => {
    clearHoldTimer();
    const state = holdStateRef.current;
    state.active = false;
    state.holdTriggered = false;
    state.openedByHold = false;
    state.path = null;
    state.source = null;
    state.keyCode = null;
    state.startedAt = null;
    state.preExistingPath = null;
    state.immediateOpen = false;
  }, [clearHoldTimer]);

  useEffect(() => {
    // Clear any in-flight hold when the binding changes.
    resetHoldState();
  }, [previewBinding, resetHoldState]);

  const startHold = useCallback(
    (
      path: string | null,
      source: "mouse" | "key",
      keyCode: string | null,
      immediateOpen: boolean,
    ) => {
      if (!path && !previewPathRef.current) return false;
      if (!previewPathRef.current && !canTriggerPreview()) return false;
      const state = holdStateRef.current;
      if (state.active) return false;
      state.active = true;
      state.holdTriggered = false;
      state.openedByHold = false;
      state.path = path;
      state.source = source;
      state.keyCode = keyCode ?? null;
      state.startedAt = Date.now();
      state.preExistingPath = previewPathRef.current ?? null;
      state.immediateOpen = immediateOpen;
      if (immediateOpen) {
        if (path && state.preExistingPath !== path) {
          openPreview(path);
          state.openedByHold = true;
        }
        return true;
      }
      state.timer = window.setTimeout(() => {
        state.holdTriggered = true;
        if (!previewPathRef.current && path) {
          openPreview(path);
          state.openedByHold = true;
        }
      }, PREVIEW_HOLD_DELAY_MS);
      return true;
    },
    [canTriggerPreview, openPreview],
  );

  const releaseHold = useCallback(
    (source: "mouse" | "key", keyCode?: string | null) => {
      const state = holdStateRef.current;
      if (!state.active || state.source !== source) return false;
      if (source === "key" && state.keyCode && keyCode && state.keyCode !== keyCode) {
        return false;
      }
      clearHoldTimer();
      const elapsed =
        state.startedAt != null ? Math.max(0, Date.now() - state.startedAt) : 0;
      const holdTriggered = state.immediateOpen
        ? elapsed >= PREVIEW_HOLD_THRESHOLD_MS
        : state.holdTriggered;
      const openedByHold = state.openedByHold;
      const path = state.path;
      const preExistingPath = state.preExistingPath;
      state.active = false;
      state.holdTriggered = false;
      state.openedByHold = false;
      state.path = null;
      state.source = null;
      state.keyCode = null;
      state.startedAt = null;
      state.preExistingPath = null;
      state.immediateOpen = false;
      if (holdTriggered) {
        if (previewPathRef.current) {
          closePreview();
          return true;
        }
        return false;
      }
      if (preExistingPath && path && preExistingPath !== path) {
        openPreview(path);
        return true;
      }
      if (preExistingPath && (!path || preExistingPath === path)) {
        closePreview();
        return true;
      }
      if (!previewPathRef.current && path) {
        openPreview(path);
        return true;
      }
      if (previewPathRef.current && openedByHold) {
        return true;
      }
      return false;
    },
    [clearHoldTimer, closePreview, openPreview],
  );

  const handlePreviewPress = useCallback(
    (path: string) => {
      if (!previewUsesMouse) return false;
      const resolved = resolvePreviewPath(path);
      if (!resolved) return false;
      return startHold(resolved, "mouse", null, true);
    },
    [previewUsesMouse, resolvePreviewPath, startHold],
  );

  const handlePreviewRelease = useCallback((_path: string) => {
    if (!previewUsesMouse) return false;
    return releaseHold("mouse", null);
  }, [previewUsesMouse, releaseHold]);

  useEffect(() => {
    if (!previewBinding || previewUsesMouse) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.isComposing) return;
      if (event.repeat) return;
      const next = buildKeybindFromEvent(event);
      if (!next || next !== previewBinding) return;
      const hoveredPath = getHoveredPreviewPath();
      const handled = startHold(hoveredPath, "key", event.code, false);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const state = holdStateRef.current;
      if (!state.active || state.source !== "key") return;
      if (state.keyCode && event.code !== state.keyCode) return;
      const handled = releaseHold("key", event.code);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [getHoveredPreviewPath, previewBinding, previewUsesMouse, releaseHold, startHold]);

  useEffect(() => {
    if (!previewUsesMouse || !previewPath) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      const handled = startHold(null, "mouse", null, true);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const handleMouseUp = (event: MouseEvent) => {
      if (event.button !== 1) return;
      const handled = releaseHold("mouse", null);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [previewPath, previewUsesMouse, releaseHold, startHold]);

  useEffect(() => {
    return () => clearHoldTimer();
  }, [clearHoldTimer]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.isComposing) return;

      const key = event.key;
      const lowerKey = key.toLowerCase();
      const hasModifier =
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;

      if (previewPath) {
        if (!hasModifier && (key === "Escape" || key === "Enter" || lowerKey === "q")) {
          event.preventDefault();
          event.stopPropagation();
          closePreview();
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [closePreview, previewPath]);

  return {
    previewPath,
    previewOpen: Boolean(previewPath),
    openPreview,
    closePreview,
    handlePreviewPress,
    handlePreviewRelease,
  };
};
