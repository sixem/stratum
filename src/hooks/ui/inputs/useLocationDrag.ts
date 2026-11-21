// Drag a navigation shortcut into either tab strip using ordinary pointer events.
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { DRAG_THRESHOLD_PX } from "@/constants";
import { createTabLocationHover, getTabLocationDropTarget, openDroppedLocation } from "@/lib/tabLocationDrop";

export const useLocationDrag = (preferHorizontalScroll = false) => {
  const cancelRef = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  const [highlight] = useState(createTabLocationHover);

  useEffect(() => () => cancelRef.current?.(), []);

  const onPointerDownCapture = (event: ReactPointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    cancelRef.current?.();
    suppressClick.current = false;
    if (event.pointerType === "touch" || !(event.target instanceof Element)) return;
    const source = event.target.closest<HTMLElement>("[data-location-path]");
    const path = source?.dataset.locationPath;
    if (!source || !path) return;

    const { clientX: startX, clientY: startY, pointerId } = event;
    const controller = new AbortController();
    const options = { signal: controller.signal, capture: true };
    let dragging = false;
    const cancel = () => {
      controller.abort();
      cancelRef.current = null;
      highlight(null);
      if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
    };
    cancelRef.current = cancel;

    window.addEventListener("pointermove", (move) => {
      if (move.pointerId !== pointerId) return;
      if (!(move.buttons & 1) || !source.isConnected) return cancel();
      if (!dragging) {
        const dx = Math.abs(move.clientX - startX);
        const dy = Math.abs(move.clientY - startY);
        if (Math.max(dx, dy) < DRAG_THRESHOLD_PX) return;
        if (preferHorizontalScroll && dx >= dy) return cancel();
        dragging = true;
        suppressClick.current = true;
        source.setPointerCapture(pointerId);
      }
      move.preventDefault();
      highlight(getTabLocationDropTarget(move.clientX, move.clientY));
    }, options);
    window.addEventListener("pointerup", (up) => {
      if (up.pointerId !== pointerId) return;
      const strip = dragging ? getTabLocationDropTarget(up.clientX, up.clientY) : null;
      cancel();
      if (strip) openDroppedLocation(strip, path);
    }, options);
    window.addEventListener("pointercancel", (cancelled) => {
      if (cancelled.pointerId === pointerId) cancel();
    }, options);
    window.addEventListener("keydown", (key) => {
      if (key.key === "Escape" && dragging) {
        key.preventDefault();
        key.stopPropagation();
        cancel();
      }
    }, options);
    window.addEventListener("blur", cancel, { signal: controller.signal });
  };

  const onClickCapture = useCallback((event: MouseEvent) => {
    if (!suppressClick.current || event.detail === 0) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return { onPointerDownCapture, onClickCapture };
};
