// Entry row rendering for the list view.
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { memo } from "react";
import type { FileEntry, RenameCommitReason } from "@/types";
import type { EntryPresence, FileKind } from "@/lib";
import { FILE_TOOLTIP_DELAY_MS } from "@/constants";
import { TooltipWrapper } from "../Tooltip";
import { RenameField } from "../RenameField";

type EntryRowProps = {
  entry: FileEntry;
  index: number;
  tooltipText: string;
  fileKind: FileKind;
  sizeLabel: string;
  modifiedLabel: string;
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

export const EntryRow = memo(({
  entry,
  index,
  tooltipText,
  fileKind,
  sizeLabel,
  modifiedLabel,
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
}: EntryRowProps) => {
  const isRemoved = presence === "removed";
  const isInteractive = !isRenaming && !isRemoved;
  const isSelectable = !isRemoved;
  const handleMouseDown = (event: ReactMouseEvent) => {
    if (!isInteractive) return;
    if (event.button === 1 && onPreviewPress) {
      onPreviewPress(entry.path);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.button === 0) {
      const hasModifier =
        event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
      // Preserve multi-selection when dragging a selected row.
      if (!selected || hasModifier) {
        onSelect(event);
      }
    }
    onOpenNewTab?.(event);
  };

  const handleMouseUp = (event: ReactMouseEvent) => {
    if (!isInteractive) return;
    if (event.button !== 1) return;
    onPreviewRelease?.(entry.path);
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
  if (isRenaming) {
    return (
      <div
        className={`row is-renaming${entry.isDir ? " is-dir" : ""}${
          selected ? " is-selected" : ""
        }${isRemoved ? " is-removed" : ""}`}
        data-selectable={isSelectable ? "true" : "false"}
        data-path={entry.path}
        data-name={entry.name}
        data-index={index}
        data-is-dir={entry.isDir ? "true" : "false"}
        data-kind={fileKind}
        data-drop-target={dropTarget ? "true" : "false"}
        data-presence={presence}
        aria-selected={selected}
        aria-hidden={isRemoved ? "true" : "false"}
      >
        <span className="name">
          <RenameField
            value={renameValue}
            isDir={entry.isDir}
            onChange={onRenameChange}
            onCommit={onRenameCommit}
            onCancel={onRenameCancel}
          />
        </span>
        <span className="size">{sizeLabel}</span>
        <span className="modified">{modifiedLabel}</span>
      </div>
    );
  }

  return (
    <TooltipWrapper text={tooltipText} delayMs={FILE_TOOLTIP_DELAY_MS}>
      <button
        type="button"
        className={`row${entry.isDir ? " is-dir" : ""}${selected ? " is-selected" : ""}${
          isRemoved ? " is-removed" : ""
        }`}
        data-selectable={isSelectable ? "true" : "false"}
        data-path={entry.path}
        data-name={entry.name}
        data-index={index}
        data-is-dir={entry.isDir ? "true" : "false"}
        data-kind={fileKind}
        data-drop-target={dropTarget ? "true" : "false"}
        data-presence={presence}
        aria-selected={selected}
        aria-hidden={isRemoved ? "true" : "false"}
        tabIndex={isInteractive ? 0 : -1}
        onClick={isInteractive ? handleClick : undefined}
        onDoubleClick={isInteractive ? onOpen : undefined}
        onMouseDown={isInteractive ? handleMouseDown : undefined}
        onMouseUp={isInteractive ? handleMouseUp : undefined}
        onPointerDown={isInteractive ? handleContextMenuDown : undefined}
        onPointerUp={isInteractive ? handleContextMenuUp : undefined}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span className="name">{entry.name}</span>
        <span className="size">{sizeLabel}</span>
        <span className="modified">{modifiedLabel}</span>
      </button>
    </TooltipWrapper>
  );
});
