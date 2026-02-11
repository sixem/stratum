// Centralizes context menu items and pointer handlers for layout + entries.
import { useCallback } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { isEditableElement } from "@/lib";
import type {
  EntryContextTarget,
  FileEntry,
  ShellAvailability,
  ShellKind,
  SortState,
} from "@/types";
import { useEntryMenuItems } from "../../menus/useEntryMenuItems";
import { useLayoutMenuItems } from "../../menus/useLayoutMenuItems";
import type { useAppMenuState } from "../useAppMenuState";

type ContextMenuState = ReturnType<typeof useAppMenuState>["contextMenu"];

type UseAppContextMenusOptions = {
  contextMenu: ContextMenuState;
  openSortMenu: (event: ReactPointerEvent) => void;
  openEntryMenu: (event: ReactPointerEvent, target: EntryContextTarget) => void;
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
  onOpenShell: (kind: ShellKind, path: string) => void;
  onOpenEntry: (path: string) => void;
  onOpenDir: (path: string) => void;
  onDeleteEntries: (paths: string[]) => Promise<{ deleted: number } | null>;
  confirmDelete: boolean;
  onClearSelection: () => void;
  onRenameEntry: (target: EntryContextTarget) => void;
  onPasteEntries: (paths: string[], destination?: string) => void;
};

export const useAppContextMenus = ({
  contextMenu,
  openSortMenu,
  openEntryMenu,
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
  onOpenShell,
  onOpenEntry,
  onOpenDir,
  onDeleteEntries,
  confirmDelete,
  onClearSelection,
  onRenameEntry,
  onPasteEntries,
}: UseAppContextMenusOptions) => {
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
    ffmpegAvailable: Boolean(shellAvailability?.ffmpeg),
  });
  const contextMenuItems =
    contextMenu?.kind === "entry" ? entryMenuItems : layoutMenuItems;
  const contextMenuOpen = Boolean(contextMenu && contextMenuItems.length > 0);

  return {
    contextMenuItems,
    contextMenuOpen,
    handleLayoutContextMenu,
    handleLayoutContextMenuDown,
    handleEntryContextMenu,
    handleEntryContextMenuDown,
  };
};
