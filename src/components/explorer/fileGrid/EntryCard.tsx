// Card that renders a single file entry in grid view.
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { splitNameExtension, stripNameExtension } from "@/lib";
import { RenameField } from "@/components/primitives/RenameField";
import type { EntryCardProps } from "./gridCard.types";
import { ThumbnailIcon } from "./ThumbnailIcon";

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
  fileKind,
  extension,
  sizeLabel,
  thumbUrl,
  appIconUrl,
  appIconsEnabled,
  disableTooltip = false,
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
  onContextMenuDown,
  onPreviewPress,
  onPreviewRelease,
  presence = "stable",
}: EntryCardProps) => {
  const resolvedSizeLabel = showSize ? sizeLabel : "";
  const extensionLabel = showExtension && extension ? extension : "";
  const showInfo = Boolean(resolvedSizeLabel) || Boolean(extensionLabel);
  const displayName =
    hideExtension && !entry.isDir ? stripNameExtension(entry.name) : entry.name;
  const nameRef = useRef<HTMLSpanElement | null>(null);
  const nameMeasureRef = useRef<HTMLSpanElement | null>(null);
  const [isNameOverflowing, setIsNameOverflowing] = useState(false);

  // Only enable middle-split rendering when the full name is actually wider than
  // the label container. This avoids unnecessary splitting for names that fit.
  useLayoutEffect(() => {
    if (nameEllipsis !== "middle") {
      setIsNameOverflowing(false);
      return;
    }

    const nameEl = nameRef.current;
    const measureEl = nameMeasureRef.current;
    if (!nameEl || !measureEl) return;

    const updateOverflow = () => {
      const nextOverflow = measureEl.offsetWidth > nameEl.clientWidth + 1;
      setIsNameOverflowing((prev) => (prev === nextOverflow ? prev : nextOverflow));
    };

    updateOverflow();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => updateOverflow());
    observer.observe(nameEl);
    return () => observer.disconnect();
  }, [displayName, nameEllipsis]);

  const nameParts =
    nameEllipsis === "middle" && isNameOverflowing
      ? buildMiddleEllipsisParts(displayName)
      : null;
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
  const tooltipDisabled = isRenaming || entry.isDir || disableTooltip || !isInteractive;
  const cardClass = `thumb-card${isRenaming ? " is-renaming" : ""}${
    entry.isDir ? " is-dir" : ""
  }${selected ? " is-selected" : ""}${isRemoved ? " is-removed" : ""}`;
  const handleMouseDown = (event: ReactMouseEvent) => {
    if (!isInteractive) return;
    if (event.button === 1) {
      const previewHandled = !entry.isDir && Boolean(onPreviewPress?.(entry.path));
      if (previewHandled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onOpenNewTab?.(event);
      if (!event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
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

  const handleMouseUp = (event: ReactMouseEvent) => {
    if (!isInteractive) return;
    if (event.button !== 1) return;
    if (!entry.isDir) {
      onPreviewRelease?.(entry.path);
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const handleClick = (event: ReactMouseEvent) => {
    if (!isInteractive) return;
    if (event.detail === 0) {
      onSelect(event);
    }
  };
  const handleContextMenuDown = (event: ReactPointerEvent) => {
    if (!isInteractive) return;
    if (event.button !== 2) return;
    event.preventDefault();
    onContextMenuDown?.(event);
  };
  const handleContextMenuUp = (event: ReactPointerEvent) => {
    if (!isInteractive) return;
    if (event.button !== 2) return;
    event.preventDefault();
    onContextMenu?.(event);
  };

  return (
    <div
      className={cardClass}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : -1}
      data-selectable={isRemoved ? "false" : "true"}
      data-grid-tooltip={entry.isDir ? "false" : "true"}
      data-tooltip-disabled={tooltipDisabled ? "true" : "false"}
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
      onMouseUp={isInteractive ? handleMouseUp : undefined}
      onPointerDown={isInteractive ? handleContextMenuDown : undefined}
      onPointerUp={isInteractive ? handleContextMenuUp : undefined}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="thumb-icon">
        <ThumbnailIcon
          isDir={entry.isDir}
          fileKind={fileKind}
          extension={extension}
          thumbUrl={thumbUrl}
          appIconUrl={appIconUrl}
          appIconsEnabled={appIconsEnabled}
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
          <span className="thumb-name" data-ellipsis={nameEllipsisMode} ref={nameRef}>
            {nameNodes}
            {nameEllipsis === "middle" ? (
              <span className="thumb-name-measure" ref={nameMeasureRef} aria-hidden="true">
                {displayName}
              </span>
            ) : null}
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
  );
});
