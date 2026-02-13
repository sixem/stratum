// Shared prop types for grid card components.
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { EntryPresence, FileKind } from "@/lib";
import type { GridNameEllipsis } from "@/modules";
import type { FileEntry, RenameCommitReason } from "@/types";

export type ThumbnailIconProps = {
  isDir: boolean;
  fileKind: FileKind;
  extension: string | null;
  thumbUrl?: string;
  appIconUrl?: string;
  appIconsEnabled?: boolean;
};

export type ThumbnailPreviewProps = {
  src: string;
  onReadyChange?: (ready: boolean) => void;
};

export type ParentCardProps = {
  path: string;
  index: number;
  selected: boolean;
  dropTarget: boolean;
  showMeta: boolean;
  onSelect: (event: ReactMouseEvent) => void;
  onOpen: (event: ReactMouseEvent) => void;
  onOpenNewTab?: (event: ReactMouseEvent) => void;
  onContextMenu?: (event: ReactPointerEvent) => void;
  onContextMenuDown?: (event: ReactPointerEvent) => void;
};

export type EntryCardProps = {
  entry: FileEntry;
  index: number;
  fileKind: FileKind;
  extension: string | null;
  sizeLabel: string;
  thumbUrl?: string;
  appIconUrl?: string;
  appIconsEnabled: boolean;
  disableTooltip?: boolean;
  showSize: boolean;
  showExtension: boolean;
  nameEllipsis: GridNameEllipsis;
  hideExtension: boolean;
  selected: boolean;
  dropTarget: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: (reason: RenameCommitReason) => void;
  onRenameCancel: () => void;
  onSelect: (event: ReactMouseEvent) => void;
  onOpen: (event: ReactMouseEvent) => void;
  onOpenNewTab?: (event: ReactMouseEvent) => void;
  onContextMenu?: (event: ReactPointerEvent) => void;
  onContextMenuDown?: (event: ReactPointerEvent) => void;
  onPreviewPress?: (path: string) => boolean;
  onPreviewRelease?: (path: string) => boolean;
  presence?: EntryPresence;
};
