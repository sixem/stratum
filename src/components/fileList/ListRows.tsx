import type { MouseEvent as ReactMouseEvent } from "react";
// Row rendering for list view entries.
import { memo } from "react";
import type { FileEntry } from "@/types";
import { FILE_TOOLTIP_DELAY_MS } from "@/constants";
import { TooltipWrapper } from "../Tooltip";

type ParentRowProps = {
  path: string;
  index: number;
  selected: boolean;
  dropTarget: boolean;
  onSelect: (event: ReactMouseEvent) => void;
  onOpen: (event: ReactMouseEvent) => void;
  onOpenNewTab?: (event: ReactMouseEvent) => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
};

export const ParentRow = memo(({
  path,
  index,
  selected,
  dropTarget,
  onSelect,
  onOpen,
  onOpenNewTab,
  onContextMenu,
}: ParentRowProps) => {
  return (
    <TooltipWrapper text={path} delayMs={FILE_TOOLTIP_DELAY_MS}>
      <button
        type="button"
        className={`row is-dir is-parent${selected ? " is-selected" : ""}`}
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
        <span className="name">..</span>
        <span className="size">-</span>
        <span className="modified">-</span>
      </button>
    </TooltipWrapper>
  );
});

type EntryRowProps = {
  entry: FileEntry;
  index: number;
  tooltipText: string;
  sizeLabel: string;
  modifiedLabel: string;
  selected: boolean;
  dropTarget: boolean;
  onSelect: (event: ReactMouseEvent) => void;
  onOpen: (event: ReactMouseEvent) => void;
  onOpenNewTab?: (event: ReactMouseEvent) => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
};

export const EntryRow = memo(({
  entry,
  index,
  tooltipText,
  sizeLabel,
  modifiedLabel,
  selected,
  dropTarget,
  onSelect,
  onOpen,
  onOpenNewTab,
  onContextMenu,
}: EntryRowProps) => {
  return (
    <TooltipWrapper text={tooltipText} delayMs={FILE_TOOLTIP_DELAY_MS}>
      <button
        type="button"
        className={`row${entry.isDir ? " is-dir" : ""}${selected ? " is-selected" : ""}`}
        data-selectable="true"
        data-path={entry.path}
        data-index={index}
        data-is-dir={entry.isDir ? "true" : "false"}
        data-drop-target={dropTarget ? "true" : "false"}
        aria-selected={selected}
        onClick={onSelect}
        onDoubleClick={onOpen}
        onMouseDown={onOpenNewTab}
        onContextMenu={onContextMenu}
      >
        <span className="name">{entry.name}</span>
        <span className="size">{sizeLabel}</span>
        <span className="modified">{modifiedLabel}</span>
      </button>
    </TooltipWrapper>
  );
});
