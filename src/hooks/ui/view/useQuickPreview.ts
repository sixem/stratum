// Manages quick preview mode for single-media selections.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { FileEntry } from "@/types";
import { isEditableElement, isPreviewableEntry } from "@/lib";
import { buildKeybindFromEvent, normalizeKeybind } from "@/modules";

export type PreviewGallerySource = {
  items: FileEntry[];
  entryByPath: Map<string, FileEntry>;
  onSelectPath: (path: string) => void;
};

export type BottomPreviewSource = {
  gallery: PreviewGallerySource;
  paneRoot: HTMLElement;
  filesRoot: HTMLElement;
  isCurrent: () => boolean;
};

export type BottomPreviewBindings = {
  registerSource: (source: BottomPreviewSource) => () => void;
  onPress: (path: string) => boolean;
};

type PreviewSession = { path: string; gallery?: PreviewGallerySource };
type PreviewTarget = { path: string; pane: BottomPreviewSource | null };

const matchesTarget = (preview: PreviewSession | null, target: PreviewTarget) =>
  preview?.path === target.path && preview.gallery === target.pane?.gallery;

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
  const [preview, setPreview] = useState<PreviewSession | null>(null);
  const previewPath = preview?.path ?? null;
  const previewRef = useRef<PreviewSession | null>(null);
  const bottomSourceRef = useRef<BottomPreviewSource | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const holdStateRef = useRef<{
    timer: number | null;
    active: boolean;
    holdTriggered: boolean;
    openedByHold: boolean;
    target: PreviewTarget | null;
    source: "mouse" | "key" | null;
    keyCode: string | null;
    startedAt: number | null;
    preExisting: PreviewSession | null;
    immediateOpen: boolean;
  }>({
    timer: null,
    active: false,
    holdTriggered: false,
    openedByHold: false,
    target: null,
    source: null,
    keyCode: null,
    startedAt: null,
    preExisting: null,
    immediateOpen: false,
  });

  const previewBinding = useMemo(
    () => normalizeKeybind(previewKeybind ?? ""),
    [previewKeybind],
  );
  const previewUsesMouse = previewBinding === "MouseMiddle";

  const canTriggerPreview = useCallback((target: PreviewTarget | null) => {
    if (settingsOpen || contextMenuOpen || promptOpen) return false;
    if (target?.pane ? !target.pane.isCurrent() : loading) return false;
    const active = document.activeElement;
    if (isEditableElement(active)) return false;
    const main = target?.pane?.filesRoot ?? mainRef.current;
    if (!main) return false;

    const hasMainFocus = Boolean(active && main.contains(active));
    const isRootFocus =
      !active || active === document.body || active === document.documentElement;

    // Bring focus back to the source file view when a toolbar or tab has it.
    if (!hasMainFocus && !isRootFocus) {
      main.focus({ preventScroll: true });
    }

    return true;
  }, [contextMenuOpen, loading, mainRef, promptOpen, settingsOpen]);

  const openPreview = useCallback((path: string, gallery?: PreviewGallerySource) => {
    setPreview({ path, gallery });
  }, []);

  const closePreview = useCallback(() => {
    setPreview(null);
  }, []);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  const registerBottomSource = useCallback((source: BottomPreviewSource) => {
    bottomSourceRef.current = source;
    return () => {
      if (bottomSourceRef.current === source) bottomSourceRef.current = null;
    };
  }, []);

  const openTarget = useCallback((target: PreviewTarget) => {
    if (target.pane && (bottomSourceRef.current !== target.pane || !target.pane.isCurrent())) return false;
    openPreview(target.path, target.pane?.gallery);
    return true;
  }, [openPreview]);

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

  const resolvePreviewTarget = useCallback(
    (path: string | undefined, fromBottom = false): PreviewTarget | null => {
      if (!path) return null;
      const pane = fromBottom ? bottomSourceRef.current : null;
      if (fromBottom && !pane?.isCurrent()) return null;
      const entry = (pane?.gallery.entryByPath ?? entryByPath).get(path);
      return entry && isPreviewableEntry(entry) ? { path: entry.path, pane } : null;
    },
    [entryByPath],
  );

  const getHoveredPreviewTarget = useCallback(() => {
    const pointer = pointerRef.current;
    if (!pointer) return null;
    const element = document.elementFromPoint(pointer.x, pointer.y) as HTMLElement | null;
    const entry = element?.closest<HTMLElement>("[data-path]");
    if (!entry) return null;
    if (entry.dataset.selectable === "false") return null;
    return resolvePreviewTarget(entry.dataset.path, Boolean(entry.closest('[data-file-pane="bottom"]')));
  }, [resolvePreviewTarget]);

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
    state.target = null;
    state.source = null;
    state.keyCode = null;
    state.startedAt = null;
    state.preExisting = null;
    state.immediateOpen = false;
  }, [clearHoldTimer]);

  useEffect(() => {
    // Clear any in-flight hold when the binding changes.
    resetHoldState();
  }, [previewBinding, resetHoldState]);

  const startHold = useCallback(
    (
      target: PreviewTarget | null,
      source: "mouse" | "key",
      keyCode: string | null,
      immediateOpen: boolean,
    ) => {
      if (!target && !previewRef.current) return false;
      if (!previewRef.current && !canTriggerPreview(target)) return false;
      const state = holdStateRef.current;
      if (state.active) return false;
      state.active = true;
      state.holdTriggered = false;
      state.openedByHold = false;
      state.target = target;
      state.source = source;
      state.keyCode = keyCode ?? null;
      state.startedAt = Date.now();
      state.preExisting = previewRef.current;
      state.immediateOpen = immediateOpen;
      if (immediateOpen) {
        if (target && !matchesTarget(state.preExisting, target)) {
          state.openedByHold = openTarget(target);
        }
        return true;
      }
      state.timer = window.setTimeout(() => {
        state.holdTriggered = true;
        if (!previewRef.current && target) {
          state.openedByHold = openTarget(target);
        }
      }, PREVIEW_HOLD_DELAY_MS);
      return true;
    },
    [canTriggerPreview, openTarget],
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
      const target = state.target;
      const preExisting = state.preExisting;
      state.active = false;
      state.holdTriggered = false;
      state.openedByHold = false;
      state.target = null;
      state.source = null;
      state.keyCode = null;
      state.startedAt = null;
      state.preExisting = null;
      state.immediateOpen = false;
      if (holdTriggered) {
        if (previewRef.current) {
          closePreview();
          return true;
        }
        return false;
      }
      if (preExisting && target && !matchesTarget(preExisting, target)) {
        return openTarget(target);
      }
      if (preExisting) {
        closePreview();
        return true;
      }
      if (!previewRef.current && target) {
        return openTarget(target);
      }
      if (previewRef.current && openedByHold) {
        return true;
      }
      return false;
    },
    [clearHoldTimer, closePreview, openTarget],
  );

  const handlePreviewPress = useCallback(
    (path: string, fromBottom = false) => {
      if (!previewUsesMouse) return false;
      const resolved = resolvePreviewTarget(path, fromBottom);
      if (!resolved) return false;
      return startHold(resolved, "mouse", null, true);
    },
    [previewUsesMouse, resolvePreviewTarget, startHold],
  );
  const bottomPreview = useMemo<BottomPreviewBindings>(() => ({
    registerSource: registerBottomSource,
    onPress: (path) => handlePreviewPress(path, true),
  }), [handlePreviewPress, registerBottomSource]);

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
      const handled = startHold(getHoveredPreviewTarget(), "key", event.code, false);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // The lower pane normally contains its own shortcuts. Give just preview
    // first refusal there so the existing window-level hold can own keyup.
    const handleBottomKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Node && bottomSourceRef.current?.paneRoot.contains(event.target)) {
        handleKeyDown(event);
      }
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
    window.addEventListener("keydown", handleBottomKeyDown, true);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keydown", handleBottomKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [getHoveredPreviewTarget, previewBinding, previewUsesMouse, releaseHold, startHold]);

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
    previewGallery: preview?.gallery,
    bottomPreview,
    previewOpen: Boolean(previewPath),
    openPreview,
    closePreview,
    handlePreviewPress,
    handlePreviewRelease,
  };
};
