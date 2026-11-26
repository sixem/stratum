// Manages quick preview sessions and activation across panes and search results.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFileKind, getPathName, isEditableElement, isPreviewableEntry } from "@/lib";
import { buildKeybindFromEvent, normalizeKeybind, useIndexedSearchUiStore, useSettingsStore } from "@/modules";
import { useQuickMoveSession } from "@/modules/quickMoveSession";
import { scopeGalleryToSelection, type PreviewGallerySource } from "./previewGallerySource";

export type { PreviewGallerySource } from "./previewGallerySource";

export type PreviewSource = {
  getGallery: (path: string) => PreviewGallerySource | undefined;
  paneRoot: HTMLElement;
  filesRoot: HTMLElement;
  isCurrent: () => boolean;
  getSelectedPath?: () => string | undefined;
  getSelectionSnapshot?: () => ReadonlySet<string>;
  shortcutInput?: HTMLInputElement;
};

export type PreviewSourceBindings = {
  registerSource: (source: PreviewSource) => () => void;
  onPress: (path: string) => boolean;
};

export type PanePreviewBindings = PreviewSourceBindings & { open: (path: string) => void };
type PreviewSourceKind = "main" | "bottom" | "indexed";

type PreviewTarget = { path: string; gallery: PreviewGallerySource; source: PreviewSourceKind };
type PreviewSession = {
  path: string;
  gallery: PreviewGallerySource;
  sourceGallery: PreviewGallerySource;
};

const matchesTarget = (preview: PreviewSession | null, target: PreviewTarget) =>
  preview?.path === target.path && preview.sourceGallery === target.gallery;

type UseQuickPreviewOptions = {
  previewKeybind: string;
  settingsOpen: boolean;
  contextMenuOpen: boolean;
  promptOpen: boolean;
};

const PREVIEW_HOLD_DELAY_MS = 220;
const PREVIEW_HOLD_THRESHOLD_MS = 220;

export const useQuickPreview = ({
  previewKeybind,
  settingsOpen,
  contextMenuOpen,
  promptOpen,
}: UseQuickPreviewOptions) => {
  const includeAudio = useSettingsStore((state) => state.galleryAudio);
  const [preview, setPreview] = useState<PreviewSession | null>(null);
  const previewPath = preview?.path ?? null;
  const previewRef = useRef<PreviewSession | null>(null);
  const sourcesRef = useRef<Partial<Record<PreviewSourceKind, PreviewSource>>>({});
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

  const canTriggerPreview = useCallback((target: PreviewTarget, mouse: boolean, modified: boolean) => {
    if (settingsOpen || contextMenuOpen || promptOpen) return false;
    if (useQuickMoveSession.getState().request) return false;
    const source = sourcesRef.current[target.source];
    if (!source?.isCurrent()) return false;
    const active = document.activeElement;
    // An explicit mouse click may leave a filter field, while typing stays in it.
    const fromShortcutInput = modified && active === source.shortcutInput;
    if (!mouse && !fromShortcutInput && isEditableElement(active)) return false;

    const hasSourceFocus = Boolean(active && source.filesRoot.contains(active));
    const isRootFocus =
      !active || active === document.body || active === document.documentElement;

    // Bring focus back to the source file view when a toolbar or tab has it.
    if (!hasSourceFocus && !isRootFocus && !fromShortcutInput) {
      source.filesRoot.focus({ preventScroll: true });
    }

    return true;
  }, [contextMenuOpen, promptOpen, settingsOpen]);

  const openPreview = useCallback((path: string, gallery: PreviewGallerySource, sourceGallery = gallery) => {
    setPreview({ path, gallery, sourceGallery });
  }, []);

  const selectPreview = useCallback((path: string) => {
    const current = previewRef.current;
    if (!current?.gallery.entryByPath.has(path)) return;
    current.gallery.onSelectPath?.(path);
    setPreview({ ...current, path });
  }, []);

  const closePreview = useCallback(() => {
    setPreview(null);
  }, []);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  const registerSource = useCallback((kind: PreviewSourceKind, source: PreviewSource) => {
    sourcesRef.current[kind] = source;
    return () => {
      if (sourcesRef.current[kind] === source) delete sourcesRef.current[kind];
    };
  }, []);

  const openTarget = useCallback((target: PreviewTarget) => {
    const source = sourcesRef.current[target.source];
    if (!source?.isCurrent() || source.getGallery(target.path) !== target.gallery) return false;
    if (target.source === "indexed") target.gallery.onSelectPath?.(target.path);
    const gallery = scopeGalleryToSelection(target.gallery, target.path, source.getSelectionSnapshot?.(), includeAudio);
    openPreview(target.path, gallery, target.gallery);
    return true;
  }, [includeAudio, openPreview]);

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
    (path: string | undefined, kind: PreviewSourceKind): PreviewTarget | null => {
      if (!path) return null;
      const source = sourcesRef.current[kind];
      if (!source?.isCurrent()) return null;
      const gallery = source.getGallery(path);
      const entry = gallery?.entryByPath.get(path);
      return gallery && entry && isPreviewableEntry(entry, includeAudio)
        ? { path: entry.path, source: kind, gallery }
        : null;
    },
    [includeAudio],
  );

  const openFromSource = useCallback((path: string, kind: PreviewSourceKind) => {
    const target = resolvePreviewTarget(path, kind);
    if (target) openTarget(target);
  }, [openTarget, resolvePreviewTarget]);

  const getHoveredPreviewTarget = useCallback(() => {
    const pointer = pointerRef.current;
    const element = pointer ? document.elementFromPoint(pointer.x, pointer.y) : null;
    const entry = element?.closest<HTMLElement>("[data-path], [data-remote-path]");
    if (useIndexedSearchUiStore.getState().open) {
      const source = sourcesRef.current.indexed;
      if (!source?.isCurrent()) return null;
      const active = document.activeElement;
      const focused = active?.closest<HTMLElement>("[data-path], [data-remote-path]");
      const path = active === source.shortcutInput ? source.getSelectedPath?.()
        : focused && source.filesRoot.contains(focused) ? focused.dataset.path
        : entry && source.filesRoot.contains(entry) ? entry.dataset.path
        : source.getSelectedPath?.();
      return resolvePreviewTarget(path, "indexed");
    }
    if (!entry) return null;
    if (entry.dataset.selectable === "false") return null;
    return resolvePreviewTarget(entry.dataset.remotePath ?? entry.dataset.path, entry.closest('[data-file-pane="bottom"]') ? "bottom" : "main");
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
      modified = false,
    ) => {
      if (!previewRef.current && (!target || !canTriggerPreview(target, source === "mouse", modified))) return false;
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
    (path: string, kind: PreviewSourceKind) => {
      if (!previewUsesMouse) return false;
      const resolved = resolvePreviewTarget(path, kind);
      if (!resolved) return false;
      return startHold(resolved, "mouse", null, true);
    },
    [previewUsesMouse, resolvePreviewTarget, startHold],
  );
  const mainPreview = useMemo<PanePreviewBindings>(() => ({
    registerSource: (source) => registerSource("main", source),
    onPress: (path) => handlePreviewPress(path, "main"),
    open: (path) => openFromSource(path, "main"),
  }), [handlePreviewPress, openFromSource, registerSource]);
  const bottomPreview = useMemo<PanePreviewBindings>(() => ({
    registerSource: (source) => registerSource("bottom", source),
    onPress: (path) => handlePreviewPress(path, "bottom"),
    open: (path) => openFromSource(path, "bottom"),
  }), [handlePreviewPress, openFromSource, registerSource]);
  const indexedPreview = useMemo<PreviewSourceBindings>(() => ({
    registerSource: (source) => registerSource("indexed", source),
    onPress: (path) => handlePreviewPress(path, "indexed"),
  }), [handlePreviewPress, registerSource]);

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
      const modified = (event.ctrlKey || event.altKey || event.metaKey) && !event.getModifierState("AltGraph");
      const current = previewRef.current;
      if (event.code === "Space" && !modified && !event.shiftKey && current) {
        const kind = getFileKind(getPathName(current.path));
        if (kind === "audio" || kind === "video") return;
      }
      const handled = startHold(getHoveredPreviewTarget(), "key", event.code, false, modified);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // The lower pane normally contains its own shortcuts. Give just preview
    // first refusal there so the existing window-level hold can own keyup.
    const handlePaneKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Node && (
        sourcesRef.current.bottom?.paneRoot.contains(target) ||
        sourcesRef.current.indexed?.paneRoot.contains(target)
      )) {
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
    window.addEventListener("keydown", handlePaneKeyDown, true);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keydown", handlePaneKeyDown, true);
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
    mainPreview,
    bottomPreview,
    indexedPreview,
    previewOpen: Boolean(previewPath),
    openPreview,
    selectPreview,
    closePreview,
    handlePreviewRelease,
  };
};
