// A single-line settings control group with discoverable horizontal overflow.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent } from "react";
import { PressOnPointerDownContext } from "@/components/primitives/PressButton";

type Props = {
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

export function SettingsPills({ children, ...label }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number; scrollLeft: number; dragging: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const left = viewport.scrollLeft > 1;
    const right = viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1;
    setEdges((current) => current.left === left && current.right === right ? current : { left, right });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    // React's wheel listener can be passive, so register this one explicitly.
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta || (delta < 0 && viewport.scrollLeft <= 0) ||
        (delta > 0 && viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1)) return;
      event.preventDefault();
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 :
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientWidth : 1;
      viewport.scrollLeft += delta * scale;
    };
    const observer = new ResizeObserver(updateEdges);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    updateEdges();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("wheel", onWheel);
    };
  }, [updateEdges]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0 ||
      event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
    suppressClickRef.current = false;
    dragRef.current = { id: event.pointerId, x: event.clientX, scrollLeft: event.currentTarget.scrollLeft, dragging: false };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const distance = event.clientX - drag.x;
    if (!drag.dragging && Math.abs(distance) < 5) return;
    if (!drag.dragging) {
      drag.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.currentTarget.scrollLeft = drag.scrollLeft - distance;
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    suppressClickRef.current = drag.dragging;
    dragRef.current = null;
    // The browser dispatches the click immediately after pointerup.
    if (suppressClickRef.current) window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  };

  return (
    <div className="settings-pills-shell" data-overflow-left={edges.left} data-overflow-right={edges.right}>
      <div ref={viewportRef} className="settings-pills" role="group" {...label}
        onScroll={updateEdges} onPointerDown={onPointerDown}
        onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag}
        onPointerLeave={() => { if (!dragRef.current?.dragging) dragRef.current = null; }}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
        }}>
        <div className="settings-pills-content" ref={contentRef}>
          <PressOnPointerDownContext.Provider value={false}>{children}</PressOnPointerDownContext.Provider>
        </div>
      </div>
    </div>
  );
}
