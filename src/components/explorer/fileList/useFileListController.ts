// Centralizes list-level dataset decoding and empty-state actions.
// This keeps FileList focused on rendering rows while the controller translates
// DOM attributes back into typed callbacks, matching the grid view structure.
import type {
  ComponentProps,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useMemo } from "react";
import { useCreateEntryPrompt } from "@/hooks";
import { getEmptyMessage, handleMiddleClick, normalizePath } from "@/lib";
import { EmptyState } from "@/components/primitives/EmptyState";
import type {
  FileListContextMenuProps,
  FileListCreationProps,
  FileListEntryContextTarget,
  FileListNavigationProps,
  FileListSelectionProps,
  FileListViewProps,
} from "./fileList.types";

type EmptyActions = ComponentProps<typeof EmptyState>["actions"];

type UseFileListControllerOptions = {
  view: FileListViewProps;
  selection: FileListSelectionProps;
  navigation: FileListNavigationProps;
  contextMenu: FileListContextMenuProps;
  creation: FileListCreationProps;
};

type ListRowDataset = {
  path: string | null;
  name: string;
  isDir: boolean;
  index: number | null;
};

const readListRowDataset = (element: HTMLElement): ListRowDataset => {
  const path = element.dataset.path ?? null;
  const rawIndex = element.dataset.index;
  const index = rawIndex == null ? null : Number(rawIndex);

  return {
    path,
    name: element.dataset.name ?? "",
    isDir: element.dataset.isDir === "true",
    index: Number.isNaN(index) ? null : index,
  };
};

const toContextTarget = (dataset: ListRowDataset): FileListEntryContextTarget | null => {
  if (!dataset.path) return null;
  return {
    path: dataset.path,
    name: dataset.name,
    isDir: dataset.isDir,
  };
};

export const useFileListController = ({
  view,
  selection,
  navigation,
  contextMenu,
  creation,
}: UseFileListControllerOptions) => {
  const isDeletePending = useCallback(
    (path: string) => {
      const key = normalizePath(path) ?? path.trim();
      return key ? selection.pendingDeletePaths.has(key) : false;
    },
    [selection.pendingDeletePaths],
  );

  const emptyMessage = useMemo(() => getEmptyMessage(view.searchQuery), [view.searchQuery]);
  const resolvedIndexMap = useMemo(() => {
    if (view.indexMap) return view.indexMap;
    const map = new Map<string, number>();
    view.items.forEach((item, index) => {
      const key = item.type === "parent" ? item.path : item.entry.path;
      map.set(key, index);
    });
    return map;
  }, [view.indexMap, view.items]);

  const handleRowSelect = useCallback(
    (event: ReactMouseEvent) => {
      const dataset = readListRowDataset(event.currentTarget as HTMLElement);
      if (!dataset.path || dataset.index == null) return;
      selection.onSelectItem(dataset.path, dataset.index, event);
    },
    [selection],
  );

  const handleRowOpen = useCallback(
    (event: ReactMouseEvent) => {
      const dataset = readListRowDataset(event.currentTarget as HTMLElement);
      if (!dataset.path) return;
      if (dataset.isDir) {
        navigation.onOpenDir(dataset.path);
        return;
      }
      navigation.onOpenEntry(dataset.path);
    },
    [navigation],
  );

  const handleRowOpenNewTab = useCallback(
    (event: ReactMouseEvent) => {
      if (!navigation.onOpenDirNewTab) return;
      const dataset = readListRowDataset(event.currentTarget as HTMLElement);
      if (!dataset.path || !dataset.isDir) return;
      handleMiddleClick(event, () => navigation.onOpenDirNewTab?.(dataset.path!));
    },
    [navigation],
  );

  const handleEntryContextMenuDown = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!contextMenu.onEntryContextMenuDown) return;
      const target = toContextTarget(readListRowDataset(event.currentTarget as HTMLElement));
      if (!target) return;
      contextMenu.onEntryContextMenuDown(event, target);
    },
    [contextMenu],
  );

  const handleEntryContextMenu = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!contextMenu.onEntryContextMenu) return;
      const target = toContextTarget(readListRowDataset(event.currentTarget as HTMLElement));
      if (!target) return;
      contextMenu.onEntryContextMenu(event, target);
    },
    [contextMenu],
  );

  const handleParentContextMenu = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const showCreatePrompt = useCreateEntryPrompt();
  const emptyActions: EmptyActions = useMemo(() => {
    if (view.searchQuery.trim()) {
      return undefined;
    }

    const actions: NonNullable<EmptyActions> = [];
    if (view.canGoUp && view.onGoUp) {
      actions.push({
        label: "Go up",
        onClick: view.onGoUp,
      });
    }
    actions.push({
      label: "New folder",
      onClick: () =>
        showCreatePrompt({
          kind: "folder",
          parentPath: view.currentPath,
          onCreate: creation.onCreateFolder,
          onCreateAndGo: creation.onCreateFolderAndGo,
        }),
    });
    actions.push({
      label: "New file",
      onClick: () =>
        showCreatePrompt({
          kind: "file",
          parentPath: view.currentPath,
          onCreate: creation.onCreateFile,
        }),
    });
    return actions;
  }, [creation, showCreatePrompt, view.canGoUp, view.currentPath, view.onGoUp, view.searchQuery]);

  return {
    isDeletePending,
    emptyMessage,
    emptyActions,
    resolvedIndexMap,
    handleRowSelect,
    handleRowOpen,
    handleRowOpenNewTab,
    handleEntryContextMenuDown,
    handleEntryContextMenu,
    handleParentContextMenu,
  };
};
