// Viewport wrapper for the virtualized thumbnail grid.
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { SelectionBox } from "@/hooks";
import { SelectionRect } from "../SelectionRect";

type ThumbViewportProps = {
  viewportRef: RefObject<HTMLDivElement | null>;
  gridVars: CSSProperties;
  contentReady: boolean;
  viewAnimate: boolean;
  selectionBox: SelectionBox | null;
  onContextMenu?: (event: ReactPointerEvent) => void;
  onContextMenuDown?: (event: ReactPointerEvent) => void;
  children: ReactNode;
};

export const ThumbViewport = ({
  viewportRef,
  gridVars,
  contentReady,
  viewAnimate,
  selectionBox,
  onContextMenu,
  onContextMenuDown,
  children,
}: ThumbViewportProps) => {
  return (
    <div
      className="thumb-viewport"
      ref={viewportRef}
      style={gridVars}
      onPointerDown={(event) => {
        if (event.button !== 2) return;
        if (!onContextMenuDown) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest(".thumb-card")) return;
        event.stopPropagation();
        onContextMenuDown(event);
      }}
      onPointerUp={(event) => {
        if (event.button !== 2) return;
        if (!onContextMenu) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest(".thumb-card")) return;
        event.stopPropagation();
        onContextMenu(event);
      }}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".thumb-card")) return;
        event.preventDefault();
      }}
    >
      <div
        className="thumb-content"
        data-ready={contentReady ? "true" : "false"}
        data-animate={viewAnimate ? "true" : "false"}
      >
        {children}
      </div>
      <SelectionRect box={selectionBox} />
    </div>
  );
};
