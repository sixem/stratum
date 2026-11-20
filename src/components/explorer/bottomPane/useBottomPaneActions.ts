// Connect the shared explorer commands to the bottom pane's current folder.
import { useLayoutEffect } from "react";
import type { RefObject } from "react";
import { useAppContextMenus, type BottomMenuBindings } from "@/hooks/ui/app/useAppContextMenus";
import { useAppRenameFlow } from "@/hooks/ui/app/useAppRenameFlow";
import { useAppSelectionHandlers } from "@/hooks/ui/app/useAppSelectionHandlers";
import { usePendingCreateSelection } from "@/hooks/ui/app/usePendingCreateSelection";
import { folderPathKey } from "@/lib";
import { refreshFileClipboard } from "@/modules";
import type { PaneActions } from "./BottomPane";
import type { useBottomFolder } from "./useBottomFolder";

type Options = {
  folder: ReturnType<typeof useBottomFolder>;
  actions: PaneActions;
  menu: BottomMenuBindings;
  files: RefObject<HTMLElement | null>;
  ready: boolean;
  viewVisit: RefObject<boolean>;
  hideExtension: boolean;
  browseFromView: (path: string) => void;
  openGallery: (path: string) => void;
  scrollTo: (index: number) => void;
  clearDragState: () => void;
};

export function useBottomPaneActions({
  folder, actions, menu, files, ready, viewVisit, hideExtension, browseFromView, openGallery, scrollTo, clearDragState,
}: Options) {
  const { dir, tabs, model, selection, viewKey } = folder;
  const { closeContextMenu } = menu;
  const rename = useAppRenameFlow({
    viewVisit,
    entries: dir.entries,
    entryByPath: model.entryByPath,
    indexMap: model.indexMap,
    selected: selection.selected,
    viewParentPath: dir.parentPath,
    gridNameHideExtension: hideExtension,
    renameEntry: actions.renameEntry,
    renameEntries: actions.renameEntries,
    setSelection: selection.setSelection,
  });
  const { handleRenameCancel } = rename;
  useLayoutEffect(() => {
    handleRenameCancel();
    return closeContextMenu;
  }, [closeContextMenu, handleRenameCancel, viewKey]);

  const selectionHandlers = useAppSelectionHandlers({
    ...rename,
    selected: selection.selected,
    gridNameHideExtension: hideExtension,
    setSelection: selection.setSelection,
    clearSelection: selection.clearSelection,
    onAfterClearSelection: clearDragState,
    handleSelectItem: selection.handleSelectItem,
  });
  const clearSelectionForVisit = () => {
    if (viewVisit.current) selectionHandlers.handleClearSelection();
  };
  const { queueCreateSelection } = usePendingCreateSelection({
    viewKey,
    viewPathKey: folderPathKey(dir.currentPath),
    viewLoading: !ready,
    indexMap: model.indexMap,
    onSelectionChange: selectionHandlers.handleSelectionChange,
    onScrollToIndex: scrollTo,
  });
  const createFile = async (parent: string, name: string) => {
    const created = await actions.createFile(parent, name);
    if (created && viewVisit.current) queueCreateSelection(created, parent);
  };
  const createFolder = async (parent: string, name: string) => {
    const created = await actions.createFolder(parent, name);
    if (created && viewVisit.current) queueCreateSelection(created, parent);
  };
  const createFolderAndGo = async (parent: string, name: string) => {
    const created = await actions.createFolder(parent, name);
    if (created && viewVisit.current) browseFromView(created);
  };
  const changeSort = (sort: typeof tabs.sortState) => {
    tabs.setSort(sort);
    void dir.loadDir(dir.currentPath, { sort, search: tabs.searchValue });
  };

  const context = useAppContextMenus({
    ...menu,
    mainRef: files,
    contextMenu: ready || menu.contextMenu?.kind === "place-target" ? menu.contextMenu : null,
    onShellCommand: () => {
      void refreshFileClipboard().catch(() => {});
      if (viewVisit.current) void dir.refreshAfterChange();
    },
    selected: selection.selected,
    entryByPath: model.entryByPath,
    onSelectionChange: selectionHandlers.handleSelectionChange,
    currentPath: ready ? dir.currentPath : "",
    viewParentPath: dir.parentPath,
    sortState: tabs.sortState,
    onSortChange: changeSort,
    onCreateFolder: createFolder,
    onCreateFolderAndGo: createFolderAndGo,
    onCreateFile: createFile,
    onOpenEntry: actions.openEntry,
    onOpenGallery: openGallery,
    onOpenDir: browseFromView,
    onOpenDirNewTab: tabs.openInNewTab,
    onDeleteEntries: actions.deleteEntries,
    onClearSelection: clearSelectionForVisit,
    onRenameEntry: selectionHandlers.handleRenameStart,
    onPasteEntries: actions.pasteEntries,
    onRemoveRecentJump: tabs.removeRecentJump,
  });

  return { ...rename, ...selectionHandlers, ...context, createFile, createFolder, createFolderAndGo, changeSort, clearSelectionForVisit };
}
