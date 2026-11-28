// Centralizes context menu items and pointer handlers for layout + entries.
import { useCallback, useEffect, useMemo } from "react";
import type { PlaceReference } from "@/lib/placeLocation";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { flushSync } from "react-dom";
import { openPathProperties, type ShellMenuTarget } from "@/api";
import type { BeginFileActivity } from "@/hooks/domain/filesystem/useFileActivity";
import { getSelectionTargets, isEditableElement, toMessage } from "@/lib";
import { applyContextMenuVisibility } from "@/lib/contextMenuVisibility";
import { setTabAnchored } from "@/lib/tabAnchors";
import { useClipboardStore, usePromptStore, useSettingsStore } from "@/modules";
import { showBottomPane } from "@/modules/bottomPaneStore";
import { hasConnectedHost } from "@/modules/remoteQuickMoveFolders";
import { useRemoteHosts } from "@/modules/remoteHosts";
import { openQuickMove } from "@/modules/quickMoveSession";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { getDefaultTabGridSize, readTabGridSize } from "@/modules/tabGridSize";
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
import { useListColumnMenu } from "../menus/useListColumnMenu";
import { isCurrentPaneDirectory, useOtherPaneDirectory, usePaneTransferTarget } from "../menus/usePaneTransferTarget";
import { copyRemoteFiles } from "@/modules/remoteTransfer";
import { buildFolderSelectionItems, invertFolderSelection, selectFolderExtension } from "../menus/entryMenu/buildFolderSelectionItems";
import { canTransferToPane, type PaneTransfer } from "../menus/entryMenu/buildPaneTransferItems";
import { withContextMenuShortcuts } from "../menus/contextMenuShortcuts";
import { resolveContextTargets } from "../menus/entryMenu/shared";
import type { CreateFolderWithSelection } from "../menus/entryMenu/showFolderWithSelectionPrompt";
import { getKeyboardMenuRequest } from "../menus/keyboardContextMenu";
import { beginSplitPicker, hasSplitTarget } from "@/modules/terminalSplit";
import type { useTabSession } from "@/hooks/domain/session/useTabSession";
import { useWindowsContextMenu } from "../menus/useWindowsContextMenu";
import { buildPlaceTargetMenuItems, isSidebarPlaceTarget } from "../menus/placeTargetMenuItems";
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
  onOpenDirInBackgroundTab: (path: string) => void;
  onOpenDirInMainPane?: (path: string) => void;
  onSelectTab: (id: string) => void;
  onCloseAnchoredTab: (id: string) => void;
  terminalTabs: Pick<ReturnType<typeof useTabSession>, "closeTab" | "endTerminalSplit">;
  onRenameFolder: (path: string, name: string) => Promise<unknown>;
  onDeleteEntries: (paths: string[]) => Promise<{ deleted: number } | null>;
  confirmDelete: boolean;
  onClearSelection: () => void;
  onRenameEntry: (target: EntryContextTarget) => void;
  onPasteEntries: (destination?: string) => void;
  onCopyEntries: (paths: string[], destination: string) => Promise<unknown>;
  onMoveEntries: (paths: string[], destination: string) => Promise<unknown>;
  onRefreshTransferDestination?: () => Promise<void>;
  onCreateFolderWithSelection?: CreateFolderWithSelection;
  onOpenConvertModal: (request: ConversionModalRequest) => void;
  onQuickConvertImages: (request: ConversionModalRequest, targetFormat: string) => void;
  places: Place[];
  onAddPlace: (path: PlaceReference, name?: string, options?: { pinned?: boolean }) => void;
  onPinPlace: (path: PlaceReference) => void;
  onUnpinPlace: (path: PlaceReference) => void;
  onRemovePlace: (path: PlaceReference) => void;
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

export type PaneFileCommands = {
  transfer: (mode: "copy" | "move", paths: string[]) => boolean;
  selectSameExtension: (path?: string) => boolean;
  invertSelection: () => boolean;
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
  onOpenDirInBackgroundTab,
  onOpenDirInMainPane,
  onSelectTab,
  onCloseAnchoredTab,
  terminalTabs,
  onRenameFolder,
  onDeleteEntries,
  confirmDelete,
  onClearSelection,
  onRenameEntry,
  onPasteEntries,
  onCopyEntries,
  onMoveEntries,
  onRefreshTransferDestination,
  onCreateFolderWithSelection,
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
  const localIndexEnabled = useSettingsStore(state => state.indexedSearchEnabled);
  const connectedHost = useRemoteHosts(hasConnectedHost);
  const quickMoveEnabled = localIndexEnabled || connectedHost;
  const menuUseWindowsForItems = useSettingsStore((state) => state.menuUseWindowsForItems);
  const includeAudio = useSettingsStore((state) => state.galleryAudio);
  const menuPaneTransfers = useSettingsStore((state) => state.menuPaneTransfers);
  const menuSelectionActions = useSettingsStore((state) => state.menuSelectionActions);
  const menuOpenBackgroundTab = useSettingsStore((state) => state.menuOpenBackgroundTab);
  const hiddenMenuActions = useSettingsStore((state) => state.hiddenContextMenuActions);
  const keybinds = useSettingsStore((state) => state.keybinds);
  const canPaste = useClipboardStore((state) => Boolean(state.clipboard?.paths.length || state.remote?.entries.length));
  // A shortcut remains usable when its menu entry is hidden.
  const transfersEnabled = menuPaneTransfers || Boolean(keybinds.copyToOtherPane || keybinds.moveToOtherPane);
  const transferTarget = usePaneTransferTarget(pane, currentPath, onRefreshTransferDestination);
  const otherTransferPane = useOtherPaneDirectory(pane);
  const remoteTarget = currentPath && transfersEnabled && otherTransferPane?.kind === "remote" ? otherTransferPane : undefined;
  const transfer = useCallback<PaneFileCommands["transfer"]>((mode, paths) => {
    const visiblePaths = paths.filter((path) => entryByPath.has(path));
    if (remoteTarget) {
      if (!visiblePaths.length ||
          !isCurrentPaneDirectory(pane, remoteTarget)) return false;
      void copyRemoteFiles(visiblePaths, remoteTarget, currentPath, "upload", mode === "move");
      return true;
    }
    if (!transferTarget) return false;
    if (!canTransferToPane(visiblePaths, transferTarget.path)) return false;
    void transferTarget.run((destination) => mode === "copy"
      ? onCopyEntries(visiblePaths, destination)
      : onMoveEntries(visiblePaths, destination));
    return true;
  }, [entryByPath, onCopyEntries, onMoveEntries, transferTarget, remoteTarget, pane, currentPath]);
  const paneTransfer = useMemo<PaneTransfer | undefined>(() => (transferTarget || remoteTarget) && ({
    destination: remoteTarget?.path ?? transferTarget!.path,
    run: transfer,
    accepts: remoteTarget ? paths => paths.length > 0 && paths.every(path => entryByPath.has(path)) : undefined,
  }), [transfer, transferTarget, remoteTarget, entryByPath]);
  const paneFileCommands = useMemo<PaneFileCommands>(() => ({
    transfer,
    selectSameExtension: (path) => Boolean(currentPath) && selectFolderExtension(entryByPath, onSelectionChange, path),
    invertSelection: () => Boolean(currentPath) && invertFolderSelection(entryByPath, selected, onSelectionChange),
  }), [currentPath, entryByPath, onSelectionChange, selected, transfer]);
  const handleQuickMove = useCallback((paths: string[]) => openQuickMove(paths, onMoveEntries), [onMoveEntries]);
  const usePaneSession = getPaneSessionStore(pane);
  const placeTarget = contextMenu?.kind === "place-target" ? contextMenu.target : null;
  const tabId = placeTarget?.source === "tab" ? placeTarget.tabId : undefined;
  const menuTab = usePaneSession(state => tabId ? state.tabs.find(tab => tab.id === tabId) : undefined);
  const terminalSidebarMenu = usePaneSession(({ activeTabId, tabs }) =>
    isSidebarPlaceTarget(placeTarget) && tabs.some(tab => tab.id === activeTabId && Boolean(tab.terminal)),
  );
  const openWindowsMenu = useWindowsContextMenu({
    enabled: windowsMenuEnabled, beginFileActivity, closeContextMenu, onCommand: onShellCommand,
  });
  const galleryAction = useCallback((entry: EntryContextTarget | undefined, target: ShellMenuTarget) => {
    if (!entry || !("paths" in target)) return;
    const path = resolveGalleryStartPath(entry, target.paths, entryByPath, includeAudio);
    if (path) return () => onOpenGallery(path);
  }, [entryByPath, includeAudio, onOpenGallery]);
  const menuTarget = useMemo<ShellMenuTarget | null>(() => {
    if (!contextMenu || !windowsMenuEnabled) return null;
    switch (contextMenu.kind) {
      case "entry":
        return { paths: resolveContextTargets(contextMenu.entry, selected, viewParentPath) };
      case "place-target":
        return !contextMenu.target.hostId && contextMenu.target.path ? { paths: [contextMenu.target.path] } : null;
      case "sort":
        return currentPath ? { backgroundPath: currentPath } : null;
      case "actions":
        return null;
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
    const request = getKeyboardMenuRequest(main, currentPath, paths, viewParentPath);
    if (!request) return false;
    const { target, point, place, listHeader } = request;
    if (native) {
      if (!target) return false;
      const entry = !place && "paths" in target ? entryByPath.get(target.paths[0]) : undefined;
      return openWindowsMenu(target, point, false, galleryAction(entry, target));
    }
    if (place) {
      openContextMenuAt({ kind: "place-target", target: place, ...point, focusFirstItem: true });
    } else if (target && "paths" in target) {
      const entry = entryByPath.get(target.paths[0]);
      if (!entry) return false;
      if (!selected.has(entry.path)) onSelectionChange([entry.path], entry.path);
      if (menuUseWindowsForItems && openWindowsMenu(target, point, false, galleryAction(entry, target))) return true;
      openContextMenuAt({ kind: "entry", entry, ...point, focusFirstItem: true });
    } else {
      openContextMenuAt({ kind: "sort", listHeader, ...point, focusFirstItem: true });
    }
    return true;
  }, [contextMenu, currentPath, entryByPath, galleryAction, mainRef, menuTarget, menuUseWindowsForItems,
    onSelectionChange, openContextMenuAt, openWindowsMenu, selected, viewParentPath]);

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
      if (event.shiftKey && !target.hostId && target.path && openWindowsMenu({ paths: [target.path] }, eventPoint(event), true)) return;
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
      if (event.shiftKey || menuUseWindowsForItems) {
        const shellTarget = { paths: resolveContextTargets(target, selected, viewParentPath) };
        if (openWindowsMenu(shellTarget, eventPoint(event), event.shiftKey, galleryAction(target, shellTarget))) return;
      }
      openEntryMenu(event, target);
    },
    [galleryAction, menuUseWindowsForItems, onSelectionChange, openEntryMenu, openWindowsMenu, selected, viewParentPath],
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
    onOpenDirInBackgroundTab: menuOpenBackgroundTab ? onOpenDirInBackgroundTab : undefined,
    otherPane,
    onDeleteEntries,
    confirmDelete,
    onClearSelection,
    onRenameEntry,
    onPasteEntries,
    onMoveEntries,
    paneTransfer: menuPaneTransfers ? paneTransfer : undefined,
    onQuickMove: quickMoveEnabled ? handleQuickMove : undefined,
    onCreateFolderWithSelection,
    onOpenConvertModal,
    onQuickConvertImages,
    menuShowConvert,
  });
  const tabActions: ContextMenuItem[] = [];
  if (menuTab) {
    tabActions.push({
      id: "anchor-tab",
      label: menuTab.anchored ? "Unanchor tab" : "Anchor tab",
      icon: "anchor",
      onSelect: () => usePaneSession.getState().setTabs(tabs => setTabAnchored(tabs, menuTab.id, !menuTab.anchored)),
    });
    if (menuTab.anchored) {
      tabActions.push({
        id: "close-anchored-tab",
        label: "Close tab",
        icon: "remove",
        onSelect: () => onCloseAnchoredTab(menuTab.id),
      });
    }
    if (menuTab.terminal && !menuTab.anchored) {
      tabActions.push({
        id: "split-terminal", label: "Split with…", icon: "split-tab", disabled: !hasSplitTarget(),
        onSelect: () => beginSplitPicker(pane, menuTab, terminalTabs.closeTab),
      });
    }
    if (menuTab.split) {
      tabActions.push(
        { id: "separate-terminal", label: "Separate tabs", icon: "separate-tabs", onSelect: () => terminalTabs.endTerminalSplit(menuTab.id, "both") },
        { id: "close-split-terminal", label: "Close PowerShell", icon: "remove", onSelect: () => terminalTabs.endTerminalSplit(menuTab.id, "folder") },
      );
      if (!menuTab.anchored) {
        tabActions.push({ id: "close-split-folder", label: "Close folder", icon: "remove",
          onSelect: () => terminalTabs.endTerminalSplit(menuTab.id, "terminal") });
      }
    }
    if (!menuTab.terminal && defaultTabGridSize !== undefined) {
      tabActions.push({
        id: "reset-tab-grid-size",
        label: "Reset thumbnail size",
        disabled: (readTabGridSize(menuTab, defaultTabGridSize) ?? defaultTabGridSize) === defaultTabGridSize,
        onSelect: () => usePaneSession.getState().setTabGridSize(menuTab.id, defaultTabGridSize),
      });
    }
  }
  const placeTargetMenuItems = buildPlaceTargetMenuItems({
    target: placeTarget,
    pane,
    places,
    tabActions,
    onOpenPath: terminalSidebarMenu ? undefined : onOpenDir,
    onOpenPathNewTab: onOpenDirNewTab,
    onOpenPathInBackgroundTab: menuOpenBackgroundTab ? onOpenDirInBackgroundTab : undefined,
    otherPane,
    onSelectTab,
    onRenameFolder,
    canPaste,
    onPasteIntoFolder: onPasteEntries,
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
  const columnMenu = useListColumnMenu(contextMenu?.kind === "sort" && contextMenu.listHeader === true);
  const selectionItems = useMemo(() => {
    if (!currentPath || !menuSelectionActions || !contextMenu ||
        contextMenu.kind === "place-target" || contextMenu.kind === "actions") return [];
    const target = contextMenu.kind === "entry" ? contextMenu.entry : undefined;
    return buildFolderSelectionItems(entryByPath, selected, onSelectionChange, target);
  }, [contextMenu, currentPath, entryByPath, menuSelectionActions, onSelectionChange, selected]);
  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (contextMenu?.kind === "actions") return contextMenu.items;
    const items = columnMenu ? [columnMenu, ...baseItems] : baseItems;
    const withSelection = selectionItems.length && items.length
      ? [...items, { kind: "divider" as const, id: "selection-menu-divider" }, ...selectionItems]
      : [...items, ...selectionItems];
    const entry = contextMenu?.kind === "entry" ? contextMenu.entry : undefined;
    const withNativeMenu = contextMenu && menuTarget ? appendWindowsMenuItem(withSelection, () => {
      openWindowsMenu(menuTarget, contextMenu, false, galleryAction(entry, menuTarget));
    }) : withSelection;
    return withContextMenuShortcuts(applyContextMenuVisibility(withNativeMenu, hiddenMenuActions), keybinds);
  }, [baseItems, columnMenu, contextMenu, galleryAction, hiddenMenuActions, keybinds, menuTarget, openWindowsMenu, selectionItems]);
  const contextMenuOpen = Boolean(contextMenu && contextMenuItems.length > 0);
  useEffect(() => {
    if (contextMenu && !contextMenuOpen) closeContextMenu();
  }, [closeContextMenu, contextMenu, contextMenuOpen]);

  return {
    paneFileCommands,
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
