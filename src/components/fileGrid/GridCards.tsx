// Grid card rendering for file thumbnails and metadata.
import type { MouseEvent as ReactMouseEvent } from "react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  buildEntryTooltip,
  formatBytes,
  getExtension,
  getFileKind,
  isPdfLikeExtension,
  splitNameExtension,
  stripNameExtension,
} from "@/lib";
import type { FileKind } from "@/lib";
import type { GridNameEllipsis } from "@/modules";
import type { EntryMeta, FileEntry } from "@/types";
import { FILE_TOOLTIP_DELAY_MS } from "@/constants";
import {
  ArchiveIcon,
  AudioIcon,
  DocumentIcon,
  ExecutableIcon,
  FallbackFileIcon,
  FileIcon,
  FolderIcon,
  ImageIcon,
  KeyIcon,
  PdfIcon,
  VideoIcon,
} from "../Icons";
import { TooltipWrapper } from "../Tooltip";

type ThumbnailIconProps = {
  isDir: boolean;
  fileKind: FileKind;
  extension: string | null;
  thumbUrl?: string;
};

type ThumbnailPreviewProps = {
  src: string;
  onReadyChange?: (ready: boolean) => void;
};

const ThumbnailPreview = ({ src, onReadyChange }: ThumbnailPreviewProps) => {
  const [ready, setReady] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useLayoutEffect(() => {
    const img = imgRef.current;
    const isReady = Boolean(img && img.complete && img.naturalWidth > 0);
    setReady(isReady);
    onReadyChange?.(isReady);
  }, [onReadyChange, src]);

  return (
    <img
      className="thumb-preview"
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading="lazy"
      decoding="async"
      data-ready={ready ? "true" : "false"}
      ref={imgRef}
      onLoad={() => {
        setReady(true);
        onReadyChange?.(true);
      }}
      onError={() => {
        setReady(false);
        onReadyChange?.(false);
      }}
    />
  );
};

export const ThumbnailIcon = ({ isDir, fileKind, extension, thumbUrl }: ThumbnailIconProps) => {
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    setPreviewReady(false);
  }, [thumbUrl]);

  if (isDir) {
    return <FolderIcon className="thumb-svg is-dir" />;
  }
  let Icon = FallbackFileIcon;
  switch (fileKind) {
    case "document":
      Icon = isPdfLikeExtension(extension) ? PdfIcon : DocumentIcon;
      break;
    case "video":
      Icon = VideoIcon;
      break;
    case "audio":
      Icon = AudioIcon;
      break;
    case "image":
      Icon = ImageIcon;
      break;
    case "executable":
      Icon = ExecutableIcon;
      break;
    case "archive":
      Icon = ArchiveIcon;
      break;
    case "secure":
      Icon = KeyIcon;
      break;
    case "generic":
      Icon = FallbackFileIcon;
      break;
  }
  return (
    <>
      {!previewReady ? <Icon className="thumb-svg" /> : null}
      {thumbUrl ? (
        <ThumbnailPreview src={thumbUrl} onReadyChange={setPreviewReady} />
      ) : null}
    </>
  );
};

type ParentCardProps = {
  path: string;
  index: number;
  selected: boolean;
  dropTarget: boolean;
  showMeta: boolean;
  onSelect: (event: ReactMouseEvent) => void;
  onOpen: (event: ReactMouseEvent) => void;
  onOpenNewTab?: (event: ReactMouseEvent) => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
};

export const ParentCard = memo(({
  path,
  index,
  selected,
  dropTarget,
  showMeta,
  onSelect,
  onOpen,
  onOpenNewTab,
  onContextMenu,
}: ParentCardProps) => {
  return (
    <button
      type="button"
      className={`thumb-card is-parent${selected ? " is-selected" : ""}`}
      data-selectable="true"
      data-path={path}
      data-index={index}
      data-is-dir="true"
      data-drop-target={dropTarget ? "true" : "false"}
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onMouseDown={onOpenNewTab}
      onContextMenu={onContextMenu}
    >
      <div className="thumb-icon">
        <span className="thumb-parent">..</span>
      </div>
      <div className="thumb-meta">
        <span className="thumb-name">Parent</span>
        {showMeta ? <div className="thumb-info">Up one level</div> : null}
      </div>
    </button>
  );
});

type EntryCardProps = {
  entry: FileEntry;
  index: number;
  meta: EntryMeta | undefined;
  thumbUrl?: string;
  showSize: boolean;
  showExtension: boolean;
  nameEllipsis: GridNameEllipsis;
  hideExtension: boolean;
  selected: boolean;
  dropTarget: boolean;
  onSelect: (event: ReactMouseEvent) => void;
  onOpen: (event: ReactMouseEvent) => void;
  onOpenNewTab?: (event: ReactMouseEvent) => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
};

// Keep a chunk of the name tail visible when using middle-ellipsis truncation.
const GRID_NAME_MIN_TAIL_CHARS = 8;
const GRID_NAME_BASE_TAIL_CHARS = 9;

const buildMiddleEllipsisParts = (name: string) => {
  const { dotExtension } = splitNameExtension(name);
  const tailTarget = Math.max(
    GRID_NAME_MIN_TAIL_CHARS,
    (dotExtension?.length ?? 0) + GRID_NAME_BASE_TAIL_CHARS,
  );
  const tailLength = Math.min(name.length, tailTarget);
  const headLength = Math.max(0, name.length - tailLength);

  return {
    head: name.slice(0, headLength),
    tail: name.slice(headLength),
  };
};

export const EntryCard = memo(({
  entry,
  index,
  meta,
  thumbUrl,
  showSize,
  showExtension,
  nameEllipsis,
  hideExtension,
  selected,
  dropTarget,
  onSelect,
  onOpen,
  onOpenNewTab,
  onContextMenu,
}: EntryCardProps) => {
  const tooltipText = buildEntryTooltip(entry, meta);
  const sizeLabel = showSize ? (entry.isDir ? "Folder" : formatBytes(meta?.size ?? null)) : "";
  const extension = entry.isDir ? null : getExtension(entry.name);
  const extensionLabel = showExtension && extension ? extension : "";
  const showInfo = Boolean(sizeLabel) || Boolean(extensionLabel);
  const fileKind = entry.isDir ? "generic" : getFileKind(entry.name);
  const displayName =
    hideExtension && !entry.isDir ? stripNameExtension(entry.name) : entry.name;
  const nameParts =
    nameEllipsis === "middle" ? buildMiddleEllipsisParts(displayName) : null;
  const useMiddleEllipsis = Boolean(nameParts && nameParts.head.length > 0);
  const nameNodes = useMiddleEllipsis
    ? [
        <span key="head" className="thumb-name-start">
          {nameParts?.head}
        </span>,
        <span key="tail" className="thumb-name-end">
          {nameParts?.tail}
        </span>,
      ]
    : displayName;
  const nameEllipsisMode = useMiddleEllipsis ? "middle" : "end";

  return (
    <TooltipWrapper text={tooltipText} delayMs={FILE_TOOLTIP_DELAY_MS}>
      <button
        type="button"
        className={`thumb-card${entry.isDir ? " is-dir" : ""}${selected ? " is-selected" : ""}`}
        data-selectable="true"
        data-path={entry.path}
        data-index={index}
        data-is-dir={entry.isDir ? "true" : "false"}
        data-kind={fileKind}
        data-drop-target={dropTarget ? "true" : "false"}
        aria-selected={selected}
        onClick={onSelect}
        onDoubleClick={onOpen}
        onMouseDown={onOpenNewTab}
        onContextMenu={onContextMenu}
      >
        <div className="thumb-icon">
          <ThumbnailIcon
            isDir={entry.isDir}
            fileKind={fileKind}
            extension={extension}
            thumbUrl={thumbUrl}
          />
        </div>
        <div className="thumb-meta">
          <span className="thumb-name" data-ellipsis={nameEllipsisMode}>
            {nameNodes}
          </span>
          {showInfo ? (
            <div className="thumb-info">
              {sizeLabel ? <span className="thumb-info-size">{sizeLabel}</span> : null}
              {extensionLabel ? (
                <span className="thumb-info-ext">{extensionLabel}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </button>
    </TooltipWrapper>
  );
});
