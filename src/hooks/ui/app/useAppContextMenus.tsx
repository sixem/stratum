// Centralizes context menu items and pointer handlers for layout + entries.
import { useCallback, useMemo } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { flushSync } from "react-dom";
import { openPathProperties, type ShellMenuTarget } from "@/api";
import type { BeginFileActivity } from "@/hooks/domain/filesystem/useFileActivity";
import { getSelectionTargets, isEditableElement, toMessage } from "@/lib";
import { usePromptStore, useSettingsStore } from "@/modules";
import { showBottomPane } from "@/modules/bottomPaneStore";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { getDefaultTabGridSize } from "@/modules/tabGridSize";
import type {
  ConversionModalRequest,
  ContextMenuItem,
  EntryContextTarget,
  FileEntry,
  Place,
  PlaceContextTarget,
  ShellAvailability,
  ShellKind,
  SortState,
} from "@/types";
import { useEntryMenuItems } from "../menus/useEntryMenuItems";
import { appendWindowsMenuItem } from "../menus/appendWindowsMenuItem";
import { useLayoutMenuItems } from "../menus/useLayoutMenuItems";
import { resolveContextTargets } from "../menus/entryMenu/shared";
import { getKeyboardMenuRequest } from "../menus/keyboardContextMenu";
import { useWindowsContextMenu } from "../menus/useWindowsContextMenu";
import { buildPlaceTargetMenuItems } from "../menus/placeTargetMenuItems";
import { resolveGalleryStartPath } from "../view/previewGallerySource";
import type { useAppMenuState } from "./useAppMenuState";

type ContextMenuState = ReturnType<typeof useAppMenuState>["contextMenu"];
const eventPoint = (event: ReactPointerEvent) => ({ x: event.clientX, y: event.clientY });

type UseAppContextMenusOptions = {
  pane?: "main" | "bottom";
  windowsMenuEnabled: boolean;
  beginFileActivity: BeginFileActivity;
  onShellCommand: () => void;
  mainRef: RefObject<HTMLElement | null>;
  contextMenu: ContextMenuState;
  openContextMenuAt: (menu: NonNullable<ContextMenuState>) => void;
  openSortMenu: (event: ReactPointerEvent) => void;
  openEntryMenu: (event: ReactPointerEvent, target: EntryContextTarget) => void;
  openPlaceTargetMenu: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
  closeContextMenu: () => void;
  selected: Set<string>;
  entryByPath: Map<string, FileEntry>;
  onSelectionChange: (paths: string[], anchor?: string) => void;
  currentPath: string;
  viewParentPath: string | null;
  sortState: SortState;
  onSortChange: (next: SortState) => void;
  onCreateFolder: (parentPath: string, name: string) => void | Promise<unknown>;
  onCreateFolderAndGo?: (parentPath: string, name: string) => void | Promise<unknown>;
  onCreateFile: (parentPath: string, name: string) => void | Promise<unknown>;
  shellAvailability: ShellAvailability | null;
  menuOpenPwsh: boolean;
  menuOpenWsl: boolean;
  menuShowConvert: boolean;
  onOpenShell: (kind: ShellKind, path: string) => void;
  onOpenEntry: (path: string) => void;
  onOpenGallery: (path: string) => void;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab: (path: string) => void;
  onOpenDirInMainPane?: (path: string) => void;
  onDeleteEntries: (paths: string[]) => Promise<{ deleted: number } | null>;
  confirmDelete: boolean;
  onClearSelection: () => void;
  onRenameEntry: (target: EntryContextTarget) => void;
  onPasteEntries: (destination?: string) => void;
  onMoveEntries: (paths: string[], destination: string) => void;
  onOpenConvertModal: (request: ConversionModalRequest) => void;
  onQuickConvertImages: (request: ConversionModalRequest, targetFormat: string) => void;
  places: Place[];
  onAddPlace: (path: string, name?: string, options?: { pinned?: boolean }) => void;
  onPinPlace: (path: string) => void;
  onUnpinPlace: (path: string) => void;
  onRemovePlace: (path: string) => void;
  onRemoveRecentJump?: (path: string) => void;
};

export type ContextMenuServices = Pick<UseAppContextMenusOptions,
  | "windowsMenuEnabled" | "beginFileActivity" | "shellAvailability" | "menuOpenPwsh"
  | "menuOpenWsl" | "menuShowConvert" | "onOpenShell" | "confirmDelete" | "onOpenConvertModal"
  | "onQuickConvertImages" | "places" | "onAddPlace" | "onPinPlace" | "onUnpinPlace" | "onRemovePlace"
>;

export type BottomMenuBindings = ContextMenuServices & ReturnType<typeof useAppMenuState>["bottomMenu"] & {
  onOpenDirInMainPane: (path: string) => void;
};

export const useAppContextMenus = ({
  pane = "main",
  windowsMenuEnabled,
  beginFileActivity,
  onShellCommand,
  mainRef,
  contextMenu,
  openContextMenuAt,
  openSortMenu,
  openEntryMenu,
  openPlaceTargetMenu,
  closeContextMenu,
  selected,
  entryByPath,
  onSelectionChange,
  currentPath,
  viewParentPath,
  sortState,
  onSortChange,
  onCreateFolder,
  onCreateFolderAndGo,
  onCreateFile,
  shellAvailability,
  menuOpenPwsh,
  menuOpenWsl,
  menuShowConvert,
  onOpenShell,
  onOpenEntry,
  onOpenGallery,
  onOpenDir,
  onOpenDirNewTab,
  onOpenDirInMainPane,
  onDeleteEntries,
  confirmDelete,
  onClearSelection,
  onRenameEntry,
  onPasteEntries,
  onMoveEntries,
  onOpenConvertModal,
  onQuickConvertImages,
  places,
  onAddPlace,
  onPinPlace,
  onUnpinPlace,
  onRemovePlace,
  onRemoveRecentJump,
}: UseAppContextMenusOptions) => {
  const defaultTabGridSize = useSettingsStore(getDefaultTabGridSize);
  const usePaneSession = getPaneSessionStore(pane);
  const tabId = contextMenu?.kind === "place-target" && contextMenu.target.source === "tab"
    ? contextMenu.target.tabId : undefined;
  const menuTab = usePaneSession(state => tabId ? state.tabs.find(tab => tab.id === tabId) : undefined);
  const openWindowsMenu = useWindowsContextMenu({
    enabled: windowsMenuEnabled, beginFileActivity, closeContextMenu, onCommand: onShellCommand,
  });
  const galleryAction = useCallback((entry: EntryContextTarget | undefined, target: ShellMenuTarget) => {
    if (!entry || !("paths" in target)) return;
    const path = resolveGalleryStartPath(entry, target.paths, entryByPath);
    if (path) return () => onOpenGallery(path);
  }, [entryByPath, onOpenGallery]);
  const menuTarget = useMemo<ShellMenuTarget | null>(() => {
    if (!contextMenu || !windowsMenuEnabled) return null;
    switch (contextMenu.kind) {
      case "entry":
        return { paths: resolveContextTargets(contextMenu.entry, selected, viewParentPath) };
      case "place-target":
        return contextMenu.target.path ? { paths: [contextMenu.target.path] } : null;
      case "sort":
        return currentPath ? { backgroundPath: currentPath } : null;
    }
  }, [contextMenu, currentPath, selected, viewParentPath, windowsMenuEnabled]);

  const openKeyboardContextMenu = useCallback((native: boolean) => {
    if (contextMenu) {
      if (!native) return true;
      const entry = contextMenu.kind === "entry" ? contextMenu.entry : undefined;
      return menuTarget ? openWindowsMenu(menuTarget, contextMenu, false, galleryAction(entry, menuTarget)) : false;
    }
    const main = mainRef.current;
    if (!main) return false;
    const paths = getSelectionTargets(selected, viewParentPath);
    const request = getKeyboardMenuRequest(main, currentPath, paths, viewParentPath, Boolean(defaultTabGridSize));
    if (!request) return false;
    const { target, point, place } = request;
    if (native) {
      if (!target) return false;
      const entry = !place && "paths" in target ? entryByPath.get(target.paths[0]) : undefined;
      return openWindowsMenu(target, point, false, galleryAction(entry, target));
    }
    if (place) {
      openContextMenuAt({ kind: "place-target", target: place, ...point });
    } else if (target && "paths" in target) {
      const entry = entryByPath.get(target.paths[0]);
      if (!entry) return false;
      if (!selected.has(entry.path)) onSelectionChange([entry.path], entry.path);
      openContextMenuAt({ kind: "entry", entry, ...point });
    } else {
      openContextMenuAt({ kind: "sort", ...point });
    }
    return true;
  }, [contextMenu, currentPath, defaultTabGridSize, entryByPath, galleryAction, mainRef, menuTarget, onSelectionChange,
    openContextMenuAt, openWindowsMenu, selected, viewParentPath]);

  const handlePlaceTargetContextMenuDown = useCallback(
    (event: ReactPointerEvent, _target: PlaceContextTarget) => {
      if (event.button !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      flushSync(() => closeContextMenu());
    },
    [closeContextMenu],
  );

  const handlePlaceTargetContextMenu = useCallback(
    (event: ReactPointerEvent, target: PlaceContextTarget) => {
      if (event.button !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey && target.path && openWindowsMenu({ paths: [target.path] }, eventPoint(event), true)) return;
      openPlaceTargetMenu(event, target);
    },
    [openPlaceTargetMenu, openWindowsMenu],
  );

  // Close on right-button press; open on release to avoid flicker.
  const handleLayoutContextMenuDown = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 2) return;
      event.preventDefault();
      flushSync(() => closeContextMenu());
    },
    [closeContextMenu],
  );

  const handleLayoutContextMenu = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 2) return;
      if (event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (target?.closest(".sidebar")) return;
      if (isEditableElement(target)) return;
      if (event.shiftKey && currentPath &&
          openWindowsMenu({ backgroundPath: currentPath }, eventPoint(event), true)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      openSortMenu(event);
    },
    [currentPath, openSortMenu, openWindowsMenu],
  );

  const handleEntryContextMenuDown = useCallback(
    (event: ReactPointerEvent, target: EntryContextTarget) => {
      if (event.button !== 2) return;
      if (!target?.path) return;
      event.preventDefault();
      event.stopPropagation();
      flushSync(() => closeContextMenu());
    },
    [closeContextMenu],
  );

  const handleEntryContextMenu = useCallback(
    (event: ReactPointerEvent, target: EntryContextTarget) => {
      if (event.button !== 2) return;
      // Right-click should align selection with the clicked entry for both files and folders.
      if (!selected.has(target.path)) {
        onSelectionChange([target.path], target.path);
      }
      if (event.shiftKey) {
        const shellTarget = { paths: resolveContextTargets(target, selected, viewParentPath) };
        if (openWindowsMenu(shellTarget, eventPoint(event), true, galleryAction(target, shellTarget))) return;
      }
      openEntryMenu(event, target);
    },
    [galleryAction, onSelectionChange, openEntryMenu, openWindowsMenu, selected, viewParentPath],
  );

  // Context menu content is derived from the current target + sort state.
  const layoutMenuItems = useLayoutMenuItems({
    currentPath,
    sortState,
    onSortChange,
    onPaste: onPasteEntries,
    onCreateFolder,
    onCreateFolderAndGo,
    onCreateFile,
    shellAvailability,
    menuOpenPwsh,
    menuOpenWsl,
    onOpenShell,
  });
  const otherPane = useMemo(() => onOpenDirInMainPane
    ? { label: "Open in main pane", open: onOpenDirInMainPane }
    : { label: "Open in bottom pane", open: showBottomPane }, [onOpenDirInMainPane]);
  const entryMenuItems = useEntryMenuItems({
    target: contextMenu?.kind === "entry" ? contextMenu.entry : null,
    selected,
    entryByPath,
    parentPath: viewParentPath,
    currentPath,
    onOpenEntry,
    onOpenGallery,
    onOpenDir,
    onOpenDirNewTab,
    otherPane,
    onDeleteEntries,
    confirmDelete,
    onClearSelection,
    onRenameEntry,
    onPasteEntries,
    onMoveEntries,
    onOpenConvertModal,
    onQuickConvertImages,
    menuShowConvert,
  });
  const placeTargetMenuItems = buildPlaceTargetMenuItems({
    target: contextMenu?.kind === "place-target" ? contextMenu.target : null,
    places,
    tabAction: menuTab && defaultTabGridSize ? {
      id: "reset-tab-grid-size",
      label: "Reset thumbnail size",
      disabled: (menuTab.gridSize ?? defaultTabGridSize) === defaultTabGridSize,
      onSelect: () => usePaneSession.getState().setTabGridSize(menuTab.id, defaultTabGridSize),
    } : undefined,
    onOpenPath: onOpenDir,
    onOpenPathNewTab: onOpenDirNewTab,
    onAddPlace,
    onPinPlace,
    onUnpinPlace,
    onRemovePlace,
    onRemoveRecentJump,
    onOpenProperties: (path) => {
      void openPathProperties(path).catch((error) => {
        usePromptStore.getState().showPrompt({
          title: "Couldn't open properties",
          content: toMessage(error, "Unable to open the properties dialog."),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      });
    },
  });
  const baseItems =
    contextMenu?.kind === "entry"
      ? entryMenuItems
      : contextMenu?.kind === "place-target"
        ? placeTargetMenuItems
        : layoutMenuItems;
  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenu || !menuTarget) return baseItems;
    const entry = contextMenu.kind === "entry" ? contextMenu.entry : undefined;
    return appendWindowsMenuItem(baseItems, () => {
      openWindowsMenu(menuTarget, contextMenu, false, galleryAction(entry, menuTarget));
    });
  }, [baseItems, contextMenu, galleryAction, menuTarget, openWindowsMenu]);
  const contextMenuOpen = Boolean(contextMenu && contextMenuItems.length > 0);

  return {
    openKeyboardContextMenu,
    contextMenuItems,
    contextMenuOpen,
    handlePlaceTargetContextMenu,
    handlePlaceTargetContextMenuDown,
    handleLayoutContextMenu,
    handleLayoutContextMenuDown,
    handleEntryContextMenu,
    handleEntryContextMenuDown,
  };
};
