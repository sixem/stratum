// Parent directory card for the grid view.
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { memo } from "react";
import { ParentUpIcon } from "@/components/icons";
import type { ParentCardProps } from "./gridCard.types";

export const ParentCard = memo(({
  path,
  index,
  dropTarget,
  showMeta,
  onSelect,
  onOpen,
  onOpenNewTab,
  onContextMenu,
  onContextMenuDown,
}: ParentCardProps) => {
  const handleMouseDown = (event: ReactMouseEvent) => {
    if (event.button === 1) {
      onOpenNewTab?.(event);
      if (!event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.button === 0) {
      onSelect?.(event);
    }
    onOpenNewTab?.(event);
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
    <button
      type="button"
      className="thumb-card is-parent"
      data-selectable="false"
      data-path={path}
      data-index={index}
      data-is-dir="true"
      data-drop-target={dropTarget ? "true" : "false"}
      aria-selected={false}
      onDoubleClick={onOpen}
      onMouseDown={handleMouseDown}
      onPointerDown={handleContextMenuDown}
      onPointerUp={handleContextMenuUp}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="thumb-icon">
        <ParentUpIcon className="thumb-parent-icon" />
      </div>
      <div className="thumb-meta">
        <span className="thumb-name">Parent</span>
        {showMeta ? <div className="thumb-info">Up one level</div> : null}
      </div>
    </button>
  );
});
