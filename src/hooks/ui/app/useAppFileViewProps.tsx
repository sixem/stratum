// Builds the FileView prop object so App.tsx stays focused on wiring.
import type { ComponentProps } from "react";
import type { FileView } from "@/components";

type FileViewProps = ComponentProps<typeof FileView>;

type UseAppFileViewPropsOptions = {
  view: Pick<
    FileViewProps,
    | "currentPath"
    | "viewMode"
    | "entries"
    | "items"
    | "indexMap"
    | "loading"
    | "showLander"
    | "searchQuery"
    | "viewKey"
    | "scrollRestoreKey"
    | "scrollRestoreTop"
    | "scrollRequest"
    | "smoothScroll"
    | "compactMode"
    | "sortState"
    | "canGoUp"
  >;
  navigation: Pick<
    FileViewProps,
    | "recentJumps"
    | "onOpenRecent"
    | "onOpenRecentNewTab"
    | "drives"
    | "driveInfo"
    | "onOpenDrive"
    | "onOpenDriveNewTab"
    | "places"
    | "onOpenPlace"
    | "onOpenPlaceNewTab"
    | "onGoUp"
    | "onOpenDir"
    | "onOpenDirNewTab"
    | "onOpenEntry"
  >;
  selection: Pick<
    FileViewProps,
    "selectedPaths" | "onSetSelection" | "onSelectItem" | "onClearSelection"
  >;
  creation: Pick<FileViewProps, "onCreateFolder" | "onCreateFolderAndGo" | "onCreateFile">;
  rename: Pick<
    FileViewProps,
    | "renameTargetPath"
    | "renameValue"
    | "onRenameChange"
    | "onRenameCommit"
    | "onRenameCancel"
  >;
  metadata: Pick<FileViewProps, "entryMeta" | "onRequestMeta">;
  thumbnails: Pick<
    FileViewProps,
    | "thumbnailsEnabled"
    | "thumbnails"
    | "onRequestThumbs"
    | "thumbnailFit"
    | "thumbnailAppIcons"
    | "thumbnailFolders"
    | "thumbnailVideos"
    | "thumbnailSvgs"
    | "categoryTinting"
    | "thumbResetKey"
    | "presenceEnabled"
  >;
  grid: Pick<
    FileViewProps,
    | "gridSize"
    | "gridAutoColumns"
    | "gridGap"
    | "gridShowSize"
    | "gridShowExtension"
    | "gridNameEllipsis"
    | "gridNameHideExtension"
    | "onGridColumnsChange"
  >;
  contextMenu: Pick<
    FileViewProps,
    "onContextMenu" | "onContextMenuDown" | "onEntryContextMenu" | "onEntryContextMenuDown"
  >;
  dragDrop: Pick<
    FileViewProps,
    "dropTargetPath" | "onStartDragOut" | "onInternalDrop" | "onInternalHover"
  >;
  preview: Pick<FileViewProps, "onEntryPreviewPress" | "onEntryPreviewRelease">;
  sort: Pick<FileViewProps, "onSortChange">;
};

export const useAppFileViewProps = ({
  view,
  navigation,
  selection,
  creation,
  rename,
  metadata,
  thumbnails,
  grid,
  contextMenu,
  dragDrop,
  preview,
  sort,
}: UseAppFileViewPropsOptions): FileViewProps => {
  // Merge grouped inputs into the FileView prop shape expected by AppContent.
  return {
    ...view,
    ...navigation,
    ...selection,
    ...creation,
    ...rename,
    ...metadata,
    ...thumbnails,
    ...grid,
    ...contextMenu,
    ...dragDrop,
    ...preview,
    ...sort,
  };
};
