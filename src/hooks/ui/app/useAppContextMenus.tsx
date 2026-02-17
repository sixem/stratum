// Centralizes context menu items and pointer handlers for layout + entries.
import { useCallback } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { isEditableElement } from "@/lib";
import type {
  ConversionModalRequest,
  EntryContextTarget,
  FileEntry,
  Place,
  PlaceContextTarget,
  ShellAvailability,
  ShellKind,
  SortState,
} from "@/types";
import { useEntryMenuItems } from "../menus/useEntryMenuItems";
import { useLayoutMenuItems } from "../menus/useLayoutMenuItems";
import { buildPlaceTargetMenuItems } from "../menus/placeTargetMenuItems";
import type { useAppMenuState } from "./useAppMenuState";

type ContextMenuState = ReturnType<typeof useAppMenuState>["contextMenu"];

type UseAppContextMenusOptions = {
  contextMenu: ContextMenuState;
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
  onPaste: (paths: string[]) => void;
  onCreateFolder: (parentPath: string, name: string) => void | Promise<unknown>;
  onCreateFolderAndGo?: (parentPath: string, name: string) => void | Promise<unknown>;
  onCreateFile: (parentPath: string, name: string) => void | Promise<unknown>;
  shellAvailability: ShellAvailability | null;
  menuOpenPwsh: boolean;
  menuOpenWsl: boolean;
  menuShowConvert: boolean;
  onOpenShell: (kind: ShellKind, path: string) => void;
  onOpenEntry: (path: string) => void;
  onOpenDir: (path: string) => void;
  onDeleteEntries: (paths: string[]) => Promise<{ deleted: number } | null>;
  confirmDelete: boolean;
  onClearSelection: () => void;
  onRenameEntry: (target: EntryContextTarget) => void;
  onPasteEntries: (paths: string[], destination?: string) => void;
  onOpenConvertModal: (request: ConversionModalRequest) => void;
  onQuickConvertImages: (request: ConversionModalRequest, targetFormat: string) => void;
  ffmpegDetected: boolean;
  places: Place[];
  onAddPlace: (path: string, name?: string, options?: { pinned?: boolean }) => void;
  onPinPlace: (path: string) => void;
  onUnpinPlace: (path: string) => void;
  onRemovePlace: (path: string) => void;
  onRemoveRecentJump?: (path: string) => void;
};

export const useAppContextMenus = ({
  contextMenu,
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
  onPaste,
  onCreateFolder,
  onCreateFolderAndGo,
  onCreateFile,
  shellAvailability,
  menuOpenPwsh,
  menuOpenWsl,
  menuShowConvert,
  onOpenShell,
  onOpenEntry,
  onOpenDir,
  onDeleteEntries,
  confirmDelete,
  onClearSelection,
  onRenameEntry,
  onPasteEntries,
  onOpenConvertModal,
  onQuickConvertImages,
  ffmpegDetected,
  places,
  onAddPlace,
  onPinPlace,
  onUnpinPlace,
  onRemovePlace,
  onRemoveRecentJump,
}: UseAppContextMenusOptions) => {
  const openPlaceMenu = useCallback(
    (event: ReactPointerEvent, target: PlaceContextTarget) => {
      openPlaceTargetMenu(event, target);
    },
    [openPlaceTargetMenu],
  );

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
      openPlaceMenu(event, target);
    },
    [openPlaceMenu],
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
      openSortMenu(event);
    },
    [openSortMenu],
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
      openEntryMenu(event, target);
    },
    [onSelectionChange, openEntryMenu, selected],
  );

  // Context menu content is derived from the current target + sort state.
  const layoutMenuItems = useLayoutMenuItems({
    currentPath,
    sortState,
    onSortChange,
    onPaste,
    onCreateFolder,
    onCreateFolderAndGo,
    onCreateFile,
    shellAvailability,
    menuOpenPwsh,
    menuOpenWsl,
    onOpenShell,
  });
  const entryMenuItems = useEntryMenuItems({
    target: contextMenu?.kind === "entry" ? contextMenu.entry : null,
    selected,
    entryByPath,
    parentPath: viewParentPath,
    currentPath,
    onOpenEntry,
    onOpenDir,
    onDeleteEntries,
    confirmDelete,
    onClearSelection,
    onRenameEntry,
    onPasteEntries,
    onOpenConvertModal,
    onQuickConvertImages,
    ffmpegDetected,
    menuShowConvert,
  });
  const placeTargetMenuItems = buildPlaceTargetMenuItems({
    target: contextMenu?.kind === "place-target" ? contextMenu.target : null,
    places,
    onAddPlace,
    onPinPlace,
    onUnpinPlace,
    onRemovePlace,
    onRemoveRecentJump,
  });
  const contextMenuItems =
    contextMenu?.kind === "entry"
      ? entryMenuItems
      : contextMenu?.kind === "place-target"
        ? placeTargetMenuItems
        : layoutMenuItems;
  const contextMenuOpen = Boolean(contextMenu && contextMenuItems.length > 0);

  return {
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
