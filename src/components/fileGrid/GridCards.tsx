// Grid card rendering for file thumbnails and metadata.
import type { MouseEvent as ReactMouseEvent } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  isPdfLikeExtension,
  isSvgLikeExtension,
  splitNameExtension,
  stripNameExtension,
} from "@/lib";
import type { FileKind } from "@/lib";
import type { GridNameEllipsis } from "@/modules";
import type { FileEntry, RenameCommitReason } from "@/types";
import type { EntryPresence } from "@/lib";
import { FILE_TOOLTIP_DELAY_MS } from "@/constants";
import {
  ArchiveIcon,
  AudioIcon,
  ExecutableFileIcon,
  FallbackFileIcon,
  FolderIcon,
  ImageIcon,
  PdfIcon,
  SecureFileIcon,
  SvgIcon,
  TextFileIcon,
  VideoIcon,
} from "../Icons";
import { TooltipWrapper } from "../Tooltip";
import { RenameField } from "../RenameField";

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
  const [displaySrc, setDisplaySrc] = useState(src);
  const [ready, setReady] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const loadIdRef = useRef(0);
  const lastReadyRef = useRef(ready);

  const setReadyState = useCallback((next: boolean) => {
    setReady((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    if (lastReadyRef.current === ready) return;
    lastReadyRef.current = ready;
    // Notify the parent after render to avoid setState during render warnings.
    onReadyChange?.(ready);
  }, [onReadyChange, ready]);

  useEffect(() => {
    if (!src) {
      loadIdRef.current += 1;
      setDisplaySrc("");
      setReadyState(false);
      return;
    }
    if (src === displaySrc) return;
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    const preload = new Image();
    preload.onload = () => {
      if (loadIdRef.current !== loadId) return;
      setDisplaySrc(src);
      setReadyState(true);
    };
    preload.onerror = () => {
      if (loadIdRef.current !== loadId) return;
      if (!displaySrc) {
        setReadyState(false);
      }
    };
    preload.src = src;
  }, [displaySrc, setReadyState, src]);

  useEffect(() => {
    if (!displaySrc) return;
    // Defer sync image readiness checks to avoid blocking paint during fast scrolls.
    const img = imgRef.current;
    const isReady = Boolean(img && img.complete && img.naturalWidth > 0);
    setReadyState(isReady);
  }, [displaySrc, setReadyState]);

  if (!displaySrc) return null;

  return (
    <img
      className="thumb-preview"
      src={displaySrc}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading="lazy"
      decoding="async"
      data-ready={ready ? "true" : "false"}
      ref={imgRef}
      onLoad={() => {
        setReadyState(true);
      }}
      onError={() => {
        setReadyState(false);
      }}
    />
  );
};

export const ThumbnailIcon = ({ isDir, fileKind, extension, thumbUrl }: ThumbnailIconProps) => {
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    if (!thumbUrl) {
      setPreviewReady(false);
    }
  }, [thumbUrl]);

  if (isDir) {
    return <FolderIcon className="thumb-svg is-dir" />;
  }
  let Icon = FallbackFileIcon;
  switch (fileKind) {
    case "document":
      Icon = isPdfLikeExtension(extension) ? PdfIcon : TextFileIcon;
      break;
    case "video":
      Icon = VideoIcon;
      break;
    case "audio":
      Icon = AudioIcon;
      break;
    case "image":
      Icon = isSvgLikeExtension(extension) ? SvgIcon : ImageIcon;
      break;
    case "executable":
      Icon = ExecutableFileIcon;
      break;
    case "archive":
      Icon = ArchiveIcon;
      break;
    case "secure":
      Icon = SecureFileIcon;
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
  const handleMouseDown = (event: ReactMouseEvent) => {
    if (event.button === 0) {
      onSelect(event);
    }
    onOpenNewTab?.(event);
  };

  const handleClick = (event: ReactMouseEvent) => {
    if (event.detail === 0) {
      onSelect(event);
    }
  };

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
      onClick={handleClick}
      onDoubleClick={onOpen}
      onMouseDown={handleMouseDown}
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
  tooltipText: string;
  fileKind: FileKind;
  extension: string | null;
  sizeLabel: string;
  thumbUrl?: string;
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
  onContextMenu?: (event: ReactMouseEvent) => void;
  presence?: EntryPresence;
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
  tooltipText,
  fileKind,
  extension,
  sizeLabel,
  thumbUrl,
  showSize,
  showExtension,
  nameEllipsis,
  hideExtension,
  selected,
  dropTarget,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onSelect,
  onOpen,
  onOpenNewTab,
  onContextMenu,
  presence = "stable",
}: EntryCardProps) => {
  const resolvedSizeLabel = showSize ? sizeLabel : "";
  const extensionLabel = showExtension && extension ? extension : "";
  const showInfo = Boolean(resolvedSizeLabel) || Boolean(extensionLabel);
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
  // Keep the card element stable so thumbnail previews do not remount on rename.
  const isRemoved = presence === "removed";
  const isInteractive = !isRenaming && !isRemoved;
  const cardClass = `thumb-card${isRenaming ? " is-renaming" : ""}${
    entry.isDir ? " is-dir" : ""
  }${selected ? " is-selected" : ""}${isRemoved ? " is-removed" : ""}`;
  const handleMouseDown = (event: ReactMouseEvent) => {
    if (!isInteractive) return;
    if (event.button === 0) {
      const hasModifier =
        event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
      // Preserve multi-selection when dragging a selected card.
      if (!selected || hasModifier) {
        onSelect(event);
      }
    }
    onOpenNewTab?.(event);
  };

  const handleClick = (event: ReactMouseEvent) => {
    if (!isInteractive) return;
    if (event.detail === 0) {
      onSelect(event);
    }
  };

  return (
    <TooltipWrapper
      text={tooltipText}
      delayMs={FILE_TOOLTIP_DELAY_MS}
      disabled={isRenaming}
    >
      <div
        className={cardClass}
        role={isInteractive ? "button" : undefined}
        tabIndex={isInteractive ? 0 : -1}
        data-selectable={isRemoved ? "false" : "true"}
        data-path={entry.path}
        data-name={entry.name}
        data-index={index}
        data-is-dir={entry.isDir ? "true" : "false"}
        data-kind={fileKind}
        data-drop-target={dropTarget ? "true" : "false"}
        data-presence={presence}
        aria-selected={selected}
        aria-hidden={isRemoved ? "true" : "false"}
        onClick={isInteractive ? handleClick : undefined}
        onDoubleClick={isInteractive ? onOpen : undefined}
        onMouseDown={isInteractive ? handleMouseDown : undefined}
        onContextMenu={isInteractive ? onContextMenu : undefined}
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
          {isRenaming ? (
            <RenameField
              value={renameValue}
              isDir={entry.isDir}
              className="rename-input rename-input-grid"
              onChange={onRenameChange}
              onCommit={onRenameCommit}
              onCancel={onRenameCancel}
            />
          ) : (
            <span className="thumb-name" data-ellipsis={nameEllipsisMode}>
              {nameNodes}
            </span>
          )}
          {showInfo ? (
            <div className="thumb-info">
              {resolvedSizeLabel ? (
                <span className="thumb-info-size">{resolvedSizeLabel}</span>
              ) : null}
              {extensionLabel ? (
                <span className="thumb-info-ext">{extensionLabel}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </TooltipWrapper>
  );
});
