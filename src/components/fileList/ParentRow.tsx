// Parent row rendering for the list view.
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { memo } from "react";
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
  onContextMenu?: (event: ReactPointerEvent) => void;
  onContextMenuDown?: (event: ReactPointerEvent) => void;
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
  onContextMenuDown,
}: ParentRowProps) => {
  const handleMouseDown = (event: ReactMouseEvent) => {
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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
  const handleContextMenuDown = (event: ReactPointerEvent) => {
    if (event.button !== 2) return;
    event.preventDefault();
    onContextMenuDown?.(event);
  };
  const handleContextMenuUp = (event: ReactPointerEvent) => {
    if (event.button !== 2) return;
    event.preventDefault();
    onContextMenu?.(event);
  };

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
        onClick={handleClick}
        onDoubleClick={onOpen}
        onMouseDown={handleMouseDown}
        onPointerDown={handleContextMenuDown}
        onPointerUp={handleContextMenuUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span className="name">..</span>
        <span className="size">-</span>
        <span className="modified">-</span>
      </button>
    </TooltipWrapper>
  );
});
