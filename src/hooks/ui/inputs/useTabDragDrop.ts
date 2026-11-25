// Pointer-driven tab reordering and moves between the two tab strips.
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { getTabLocationDropTarget } from "@/lib/tabLocationDrop";
import type { TabTransfer } from "@/types/tabs";

type UseTabDragDropOptions = {
  containerRef: RefObject<HTMLElement | null>;
  stripRef: RefObject<HTMLElement | null>;
  onReorder: (fromId: string, toIndex: number) => void;
  onMoveTab: (id: string, receive: (transfer: TabTransfer) => boolean) => void;
  onReceiveTab: (transfer: TabTransfer, toIndex: number) => boolean;
};

type DropSlot = { index: number; indicatorX: number };
type TabStrip = {
  measure: (clientX: number, anchored: boolean) => DropSlot | null;
  showIndicator: (x: number | null, incoming?: boolean) => void;
  receive: UseTabDragDropOptions["onReceiveTab"];
};

type DragState = {
  active: boolean;
  dragging: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  tabId: string | null;
  anchored: boolean;
};

const DRAG_THRESHOLD = 4;
const SUPPRESS_TIMEOUT_MS = 400;
const tabStrips = new WeakMap<HTMLElement, TabStrip>();

function measureDropSlot(container: HTMLElement, clientX: number, anchored: boolean): DropSlot {
  const tabs = container.querySelectorAll<HTMLElement>(".tab[data-tab-id]");
  const bounds = container.getBoundingClientRect();
  let edge = bounds.left;
  let index = 0;
  for (const tab of tabs) {
    const tabAnchored = tab.dataset.tabAnchored === "true";
    if (anchored && !tabAnchored) break;
    const rect = tab.getBoundingClientRect();
    if (anchored === tabAnchored && clientX < rect.left + rect.width / 2) {
      edge = rect.left;
      break;
    }
    index += 1;
    edge = rect.right;
  }
  const offset = Math.max(0, Math.min(edge - bounds.left, container.clientWidth - 2));
  return { index, indicatorX: offset + container.scrollLeft };
}

export const useTabDragDrop = ({ containerRef, stripRef, onReorder, onMoveTab, onReceiveTab }: UseTabDragDropOptions) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicatorX, setDropIndicatorX] = useState<number | null>(null);
  const [receivingTab, setReceivingTab] = useState(false);
  const hoveredRef = useRef<TabStrip | null>(null);
  const dragRef = useRef<DragState>({
    active: false,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    tabId: null,
    anchored: false,
  });
  const callbacksRef = useRef({ onReorder, onMoveTab, onReceiveTab });
  const windowTrackingRef = useRef<AbortController | null>(null);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    callbacksRef.current = { onReorder, onMoveTab, onReceiveTab };
  }, [onReorder, onMoveTab, onReceiveTab]);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    tabStrips.set(strip, {
      measure: (x, anchored) => containerRef.current ? measureDropSlot(containerRef.current, x, anchored) : null,
      showIndicator: (x, incoming = false) => {
        setDropIndicatorX(x);
        setReceivingTab(incoming);
      },
      receive: (transfer, index) => callbacksRef.current.onReceiveTab(transfer, index),
    });
    return () => { tabStrips.delete(strip); };
  }, [containerRef, stripRef]);

  const resolveDrop = (event: PointerEvent) => {
    const strip = getTabLocationDropTarget(event.clientX, event.clientY);
    if (!strip) return null;
    const incoming = strip !== stripRef.current;
    const { anchored } = dragRef.current;
    if (incoming && anchored) return null;
    const target = tabStrips.get(strip);
    const slot = target?.measure(event.clientX, anchored);
    return target && slot ? { target, slot, incoming } : null;
  };

  const showDrop = (drop: ReturnType<typeof resolveDrop>) => {
    const target = drop?.target ?? null;
    if (hoveredRef.current !== target) hoveredRef.current?.showIndicator(null);
    hoveredRef.current = target;
    drop?.target.showIndicator(drop.slot.indicatorX, drop.incoming);
  };

  const clearSuppress = () => {
    suppressClickRef.current = false;
    if (suppressTimerRef.current != null) {
      window.clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
  };

  const armSuppress = () => {
    suppressClickRef.current = true;
    if (suppressTimerRef.current != null) {
      window.clearTimeout(suppressTimerRef.current);
    }
    suppressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressTimerRef.current = null;
    }, SUPPRESS_TIMEOUT_MS);
  };

  const resetDrag = () => {
    dragRef.current = {
      active: false,
      dragging: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      tabId: null,
      anchored: false,
    };
  };

  const stopWindowTracking = () => {
    windowTrackingRef.current?.abort();
    windowTrackingRef.current = null;
  };

  const finishDrag = () => {
    if (dragRef.current.dragging) armSuppress();
    stopWindowTracking();
    resetDrag();
    setDraggingId(null);
    showDrop(null);
  };

  const handlePointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const dx = Math.abs(event.clientX - drag.startX);
    const dy = Math.abs(event.clientY - drag.startY);
    if (!drag.dragging && dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
      return;
    }
    if (!drag.dragging) {
      drag.dragging = true;
      setDraggingId(drag.tabId);
    }
    showDrop(resolveDrop(event));
  };

  const handlePointerUp = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const tabId = drag.tabId;
    const drop = drag.dragging ? resolveDrop(event) : null;
    finishDrag();
    if (!tabId || !drop) return;
    if (drop.incoming) {
      callbacksRef.current.onMoveTab(tabId, (transfer) => drop.target.receive(transfer, drop.slot.index));
    } else {
      callbacksRef.current.onReorder(tabId, drop.slot.index);
    }
  };

  const handlePointerCancel = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    finishDrag();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, id: string, anchored: boolean) => {
    if (event.button !== 0) return;
    stopWindowTracking();
    dragRef.current = {
      active: true,
      dragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      tabId: id,
      anchored,
    };
    const tracking = new AbortController();
    windowTrackingRef.current = tracking;
    const { signal } = tracking;
    window.addEventListener("pointermove", handlePointerMove, { signal });
    // The bottom pane stops pointer-up bubbling to keep its own commands isolated.
    window.addEventListener("pointerup", handlePointerUp, { signal, capture: true });
    window.addEventListener("pointercancel", handlePointerCancel, { signal, capture: true });
    window.addEventListener("blur", finishDrag, { signal });
    window.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key !== "Escape" || !dragRef.current.dragging) return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finishDrag();
    }, { signal, capture: true });
  };

  const handleSuppressClick = (event: ReactMouseEvent) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    clearSuppress();
  };

  useLayoutEffect(() => {
    return () => {
      stopWindowTracking();
      clearSuppress();
      showDrop(null);
    };
  }, []);

  return {
    draggingId,
    dropIndicatorX,
    receivingTab,
    handlePointerDown,
    handleSuppressClick,
  };
};
