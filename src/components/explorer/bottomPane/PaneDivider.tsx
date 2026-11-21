// Both the pane grid and sidebar edge use the same live split height.
import { useLayoutEffect, useRef } from "react";
import {
  MIN_BOTTOM_PANE_HEIGHT, MIN_MAIN_PANE_HEIGHT, PANE_DIVIDER_HEIGHT, useBottomPaneStore,
} from "@/modules/bottomPaneStore";

type HeightBounds = { min: number; max: number };
type Resize = HeightBounds & { id: number; startY: number; startHeight: number; layout: HTMLElement };

const clampHeight = (height: number, { min, max }: HeightBounds) => Math.min(max, Math.max(min, Math.round(height)));

function readSplit(divider: HTMLElement) {
  const stack = divider.parentElement;
  const layout = stack?.parentElement;
  const upper = divider.previousElementSibling;
  if (!stack || !layout || !upper) return null;
  const stackHeight = stack.getBoundingClientRect().height;
  const available = stackHeight - PANE_DIVIDER_HEIGHT;
  const max = Math.max(0, Math.floor(available - Math.min(MIN_MAIN_PANE_HEIGHT, stackHeight / 2)));
  const min = Math.min(MIN_BOTTOM_PANE_HEIGHT, max);
  const height = clampHeight(available - upper.getBoundingClientRect().height, { min: 0, max });
  return { layout, stack, upper, height, min, max };
}

function setDividerValue(divider: HTMLElement, height: number) {
  divider.setAttribute("aria-valuenow", String(height));
  divider.setAttribute("aria-valuetext", `${height} pixels`);
}

export function PaneDivider() {
  const heightUnit = useBottomPaneStore(state => state.heightUnit);
  const dividerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Resize | null>(null);
  useLayoutEffect(() => () => {
    drag.current?.layout.style.removeProperty("--bottom-preview");
  }, []);

  useLayoutEffect(() => {
    const divider = dividerRef.current;
    if (!divider) return;
    const split = readSplit(divider);
    if (!split) return;
    const sync = () => {
      if (drag.current) return;
      const measured = readSplit(divider);
      if (!measured) return;
      const { height, min, max } = measured;
      if (max > 0 && useBottomPaneStore.getState().heightUnit === "%") {
        useBottomPaneStore.setState({ height: Math.max(MIN_BOTTOM_PANE_HEIGHT, height), heightUnit: "px" });
      }
      divider.setAttribute("aria-valuemin", String(min));
      divider.setAttribute("aria-valuemax", String(max));
      setDividerValue(divider, height);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(split.stack);
    observer.observe(split.upper);
    return () => observer.disconnect();
  }, [heightUnit]);

  return (
    <div
      ref={dividerRef}
      className="pane-divider"
      role="separator"
      tabIndex={0}
      aria-label="Bottom pane height"
      aria-orientation="horizontal"
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return;
        const split = readSplit(event.currentTarget);
        if (!split) return;
        event.preventDefault();
        drag.current = { layout: split.layout, id: event.pointerId, startY: event.clientY, startHeight: split.height, min: split.min, max: split.max };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (!active || event.pointerId !== active.id) return;
        const height = clampHeight(active.startHeight + active.startY - event.clientY, active);
        active.layout.style.setProperty("--bottom-preview", `${height}px`);
        setDividerValue(event.currentTarget, height);
      }}
      onPointerUp={event => {
        const active = drag.current;
        if (!active || event.pointerId !== active.id) return;
        const split = readSplit(event.currentTarget);
        if (!split) return;
        const height = clampHeight(active.startHeight + active.startY - event.clientY, split);
        if (height !== active.startHeight) {
          useBottomPaneStore.setState({ height, heightUnit: "px" });
        }
      }}
      onLostPointerCapture={event => {
        drag.current?.layout.style.removeProperty("--bottom-preview");
        drag.current = null;
        const split = readSplit(event.currentTarget);
        if (split) setDividerValue(event.currentTarget, split.height);
      }}
      onKeyDown={event => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();
        const split = readSplit(event.currentTarget);
        if (!split) return;
        const height = clampHeight(split.height + (event.key === "ArrowUp" ? 16 : -16), split);
        if (height !== split.height) useBottomPaneStore.setState({ height, heightUnit: "px" });
      }}
    />
  );
}
