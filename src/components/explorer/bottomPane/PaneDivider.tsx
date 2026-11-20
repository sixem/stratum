// Preview a resize on the grid itself. Save only the final pointer position.
import { useRef } from "react";
import { clampPaneHeight, useBottomPaneStore } from "@/modules/bottomPaneStore";

type Resize = { id: number; startY: number; percent: number; stackHeight: number };

function heightAt(drag: Resize, y: number) {
  return clampPaneHeight(drag.percent + 100 * (drag.startY - y) / drag.stackHeight);
}

export function PaneDivider() {
  const saved = useBottomPaneStore(state => state.height);
  const drag = useRef<Resize | null>(null);
  return (
    <div
      className="pane-divider"
      role="separator"
      tabIndex={0}
      aria-label="Bottom pane height"
      aria-orientation="horizontal"
      aria-valuemin={22}
      aria-valuemax={70}
      aria-valuenow={Math.round(saved)}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return;
        const stackHeight = event.currentTarget.parentElement?.clientHeight;
        if (!stackHeight) return;
        event.preventDefault();
        drag.current = { id: event.pointerId, startY: event.clientY, percent: saved, stackHeight };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (!active || event.pointerId !== active.id) return;
        const value = heightAt(active, event.clientY);
        event.currentTarget.parentElement?.style.setProperty("--bottom-preview", value + "%");
        event.currentTarget.setAttribute("aria-valuenow", String(Math.round(value)));
      }}
      onPointerUp={event => {
        const active = drag.current;
        if (active && event.pointerId === active.id) {
          useBottomPaneStore.setState({ height: heightAt(active, event.clientY) });
        }
      }}
      onLostPointerCapture={event => {
        drag.current = null;
        event.currentTarget.parentElement?.style.removeProperty("--bottom-preview");
        const height = useBottomPaneStore.getState().height;
        event.currentTarget.setAttribute("aria-valuenow", String(Math.round(height)));
      }}
      onKeyDown={event => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();
        useBottomPaneStore.setState({ height: clampPaneHeight(saved + (event.key === "ArrowUp" ? 5 : -5)) });
      }}
    />
  );
}
