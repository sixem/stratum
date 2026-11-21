// Let the drive strip follow a mouse drag without treating it as a drive click.
import { useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { DRAG_THRESHOLD_PX } from "@/constants";

type Drag = {
  pointerId: number;
  element: HTMLDivElement;
  startX: number;
  startScrollLeft: number;
  moved: boolean;
};

export const useDrivePickerDragScroll = (enabled: boolean) => {
  const dragRef = useRef<Drag | null>(null);
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (enabled) return;
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.element.hasPointerCapture(drag.pointerId)) {
      drag.element.releasePointerCapture(drag.pointerId);
    }
    setDragging(false);
  }, [enabled]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClickRef.current = false;
    if (!enabled || event.pointerType === "touch") return;
    dragRef.current = {
      pointerId: event.pointerId,
      element: event.currentTarget,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) setDragging(false);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!enabled || drag?.pointerId !== event.pointerId) return;
    if (!(event.buttons & 1)) {
      finish(event);
      return;
    }
    const delta = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      suppressClickRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    event.preventDefault();
    event.currentTarget.scrollTo({ left: drag.startScrollLeft - delta, behavior: "instant" });
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    // A keyboard click has detail 0. A new pointer press also clears this flag.
    if (!suppressClickRef.current || event.detail === 0) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    dragging,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onPointerLeave: (event: PointerEvent<HTMLDivElement>) => {
        if (!dragRef.current?.moved) finish(event);
      },
      onClickCapture,
    },
  };
};
