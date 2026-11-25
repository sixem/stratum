// Anchored drag-drop submenu for revealing secondary destinations near a host target.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronUpIcon } from "@/components/icons";
import { ScrollArea } from "@/components/primitives";
import { getDropTargetFromPoint } from "@/lib";
import type { DropTarget, DropTargetSubmenuItem } from "@/lib";
import { clampOverlayStart, resolvePopoverVerticalPlacement } from "./overlayUtils";
import { useOverlayAutoUpdate } from "./useOverlayAutoUpdate";

type DropTargetSubmenuProps = {
  open: boolean;
  anchorElement: HTMLElement | null;
  scrollElement?: HTMLElement | null;
  hostTabId: string | null;
  hostPath: string | null;
  items: DropTargetSubmenuItem[];
  loading: boolean;
  activePath?: string | null;
  dragPoint?: { x: number; y: number } | null;
  onHoverTargetChange?: (target: DropTarget | null) => void;
  onRequestClose?: () => void;
};

const MENU_EDGE = 10;
const MENU_GAP = 4;
const MENU_MIN_HEIGHT = 96;
const MENU_MAX_WIDTH = 280;
const MENU_MIN_WIDTH = 180;
const MENU_MAX_VIEWPORT_HEIGHT_RATIO = 0.34;
const POSITION_EPSILON_PX = 0.5;
const AUTO_SCROLL_EDGE_PX = 64;
const AUTO_SCROLL_MIN_SPEED_PX_PER_SECOND = 34;
const AUTO_SCROLL_MAX_SPEED_PX_PER_SECOND = 260;

export const DropTargetSubmenu = ({
  open,
  anchorElement,
  scrollElement = null,
  hostTabId,
  hostPath,
  items,
  loading,
  activePath = null,
  dragPoint = null,
  onHoverTargetChange,
  onRequestClose,
}: DropTargetSubmenuProps) => {
  const anchorRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const positionFrameRef = useRef<number | null>(null);
  const followupPositionFrameRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollLastTimestampRef = useRef<number | null>(null);
  const autoScrollRemainderRef = useRef(0);
  const lastDragPointRef = useRef<{ x: number; y: number } | null>(null);
  const [menuReady, setMenuReady] = useState(false);
  const [menuPosition, setMenuPosition] = useState({
    top: 0,
    left: 0,
    width: MENU_MIN_WIDTH,
    maxHeight: 260,
    dropUp: false,
  });

  anchorRef.current = anchorElement;

  const updateMenuPosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const measuredHeight = menuRef.current?.offsetHeight ?? 240;
    const maxViewportHeight = Math.max(
      MENU_MIN_HEIGHT,
      Math.floor(viewportHeight * MENU_MAX_VIEWPORT_HEIGHT_RATIO),
    );
    const width = Math.min(
      Math.max(rect.width, MENU_MIN_WIDTH),
      Math.max(MENU_MIN_WIDTH, viewportWidth - MENU_EDGE * 2),
      MENU_MAX_WIDTH,
    );
    const { dropUp, maxHeight, top } = resolvePopoverVerticalPlacement({
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
      overlayHeight: Math.min(measuredHeight, maxViewportHeight),
      viewportHeight,
      edge: MENU_EDGE,
      gap: MENU_GAP,
      minHeight: MENU_MIN_HEIGHT,
    });
    const cappedMaxHeight = Math.min(maxHeight, maxViewportHeight);
    const left = clampOverlayStart(rect.left, width, viewportWidth, MENU_EDGE);
    setMenuPosition((previous) => {
      const topChanged = Math.abs(previous.top - top) > POSITION_EPSILON_PX;
      const leftChanged = Math.abs(previous.left - left) > POSITION_EPSILON_PX;
      const widthChanged = Math.abs(previous.width - width) > POSITION_EPSILON_PX;
      const maxHeightChanged =
        Math.abs(previous.maxHeight - cappedMaxHeight) > POSITION_EPSILON_PX;
      if (
        !topChanged &&
        !leftChanged &&
        !widthChanged &&
        !maxHeightChanged &&
        previous.dropUp === dropUp
      ) {
        return previous;
      }
      return {
        top,
        left,
        width,
        maxHeight: cappedMaxHeight,
        dropUp,
      };
    });
  }, []);

  const cancelScheduledPositionRefresh = useCallback(() => {
    if (positionFrameRef.current != null) {
      window.cancelAnimationFrame(positionFrameRef.current);
      positionFrameRef.current = null;
    }
    if (followupPositionFrameRef.current != null) {
      window.cancelAnimationFrame(followupPositionFrameRef.current);
      followupPositionFrameRef.current = null;
    }
  }, []);

  const stopAutoScroll = useCallback(() => {
    autoScrollRemainderRef.current = 0;
    autoScrollLastTimestampRef.current = null;
    if (autoScrollFrameRef.current != null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }, []);

  const computeAutoScrollVelocity = useCallback((point: { x: number; y: number } | null) => {
    const viewport = viewportRef.current;
    if (!point || !viewport) return 0;
    if (viewport.scrollHeight <= viewport.clientHeight + 1) return 0;
    const rect = viewport.getBoundingClientRect();
    if (
      point.x < rect.left ||
      point.x > rect.right ||
      point.y < rect.top ||
      point.y > rect.bottom
    ) {
      return 0;
    }
    const edgeSize = Math.min(AUTO_SCROLL_EDGE_PX, rect.height / 2);
    const resolveVelocity = (distanceFromEdge: number, direction: -1 | 1) => {
      const normalized = 1 - distanceFromEdge / edgeSize;
      const eased = normalized * normalized;
      const speed =
        AUTO_SCROLL_MIN_SPEED_PX_PER_SECOND +
        (AUTO_SCROLL_MAX_SPEED_PX_PER_SECOND - AUTO_SCROLL_MIN_SPEED_PX_PER_SECOND) *
          eased;
      return direction * speed;
    };
    const topDistance = point.y - rect.top;
    if (topDistance < edgeSize) {
      return resolveVelocity(topDistance, -1);
    }
    const bottomDistance = rect.bottom - point.y;
    if (bottomDistance < edgeSize) {
      return resolveVelocity(bottomDistance, 1);
    }
    return 0;
  }, []);

  const runAutoScrollStep = useCallback(
    (timestamp: number) => {
      const viewport = viewportRef.current;
      const point = lastDragPointRef.current;
      const velocity = computeAutoScrollVelocity(point);
      if (!viewport || !point || velocity === 0) {
        stopAutoScroll();
        return;
      }

      const previousTimestamp = autoScrollLastTimestampRef.current;
      if (previousTimestamp == null) {
        autoScrollLastTimestampRef.current = timestamp;
        autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScrollStep);
        return;
      }

      autoScrollLastTimestampRef.current = timestamp;
      const deltaSeconds = Math.min(0.032, (timestamp - previousTimestamp) / 1000);
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const previousScrollTop = viewport.scrollTop;
      const scrollDelta = autoScrollRemainderRef.current + velocity * deltaSeconds;
      const nextScrollTop = Math.max(
        0,
        Math.min(maxScrollTop, previousScrollTop + scrollDelta),
      );
      viewport.scrollTop = nextScrollTop;
      const appliedScrollTop = viewport.scrollTop;
      // The browser can round scrollTop to whole pixels. Carry the difference into the next frame.
      autoScrollRemainderRef.current = nextScrollTop - appliedScrollTop;
      if (appliedScrollTop !== previousScrollTop) {
        onHoverTargetChange?.(getDropTargetFromPoint(point.x, point.y));
      }
      if (nextScrollTop === (velocity > 0 ? maxScrollTop : 0)) {
        stopAutoScroll();
        return;
      }
      autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScrollStep);
    },
    [computeAutoScrollVelocity, onHoverTargetChange, stopAutoScroll],
  );

  const ensureAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current != null) return;
    autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScrollStep);
  }, [runAutoScrollStep]);

  const updateAutoScrollFromPoint = useCallback(
    (point: { x: number; y: number } | null) => {
      lastDragPointRef.current = point;
      if (computeAutoScrollVelocity(point) === 0) {
        stopAutoScroll();
        return;
      }
      ensureAutoScroll();
    },
    [computeAutoScrollVelocity, ensureAutoScroll, stopAutoScroll],
  );

  const schedulePositionRefresh = useCallback((revealWhenSettled = false) => {
    cancelScheduledPositionRefresh();
    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null;
      updateMenuPosition();
      followupPositionFrameRef.current = window.requestAnimationFrame(() => {
        followupPositionFrameRef.current = null;
        updateMenuPosition();
        if (revealWhenSettled) {
          setMenuReady(true);
        }
      });
    });
  }, [cancelScheduledPositionRefresh, updateMenuPosition]);

  useLayoutEffect(() => {
    if (!open || !anchorElement) {
      cancelScheduledPositionRefresh();
      setMenuReady(false);
      return;
    }
    updateMenuPosition();
    if (!menuReady) {
      schedulePositionRefresh(true);
      return;
    }
    schedulePositionRefresh();
  }, [
    anchorElement,
    cancelScheduledPositionRefresh,
    items.length,
    loading,
    menuReady,
    open,
    schedulePositionRefresh,
    updateMenuPosition,
  ]);

  useOverlayAutoUpdate({
    enabled: open && Boolean(anchorElement),
    onUpdate: updateMenuPosition,
    observeRefs: [anchorRef, menuRef],
    watchScroll: true,
  });

  useEffect(() => cancelScheduledPositionRefresh, [cancelScheduledPositionRefresh]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  useEffect(() => {
    if (!open || !scrollElement) return;
    scrollElement.addEventListener("scroll", updateMenuPosition, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", updateMenuPosition);
    };
  }, [open, scrollElement, updateMenuPosition]);

  useEffect(() => {
    if (open && menuReady) updateAutoScrollFromPoint(dragPoint);
    else {
      lastDragPointRef.current = null;
      stopAutoScroll();
    }
  }, [dragPoint, menuReady, open, stopAutoScroll, updateAutoScrollFromPoint]);

  useEffect(() => {
    if (!open || !onRequestClose) return;
    // The native drop event must hit-test the visible menu before it closes.
    // A browser pointerup can arrive before that event crosses the IPC bridge.
    const closeWhenHidden = () => {
      if (document.hidden) onRequestClose();
    };
    document.addEventListener("visibilitychange", closeWhenHidden);
    return () => document.removeEventListener("visibilitychange", closeWhenHidden);
  }, [onRequestClose, open]);

  if (!open || !anchorElement || !hostTabId || !hostPath) {
    return null;
  }

  return createPortal(
    <div
      className="drop-submenu-surface"
      data-drop-submenu-tab-id={hostTabId}
      data-drop-up={menuPosition.dropUp || undefined}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        "--drop-submenu-gap": `${MENU_GAP}px`,
        top: `${menuPosition.top}px`,
        left: `${menuPosition.left}px`,
        width: `${menuPosition.width}px`,
        visibility: menuReady ? "visible" : "hidden",
        pointerEvents: menuReady ? "auto" : "none",
      } as CSSProperties}
    >
      <div
        ref={menuRef}
        className={`drop-submenu${menuPosition.dropUp ? " is-drop-up" : " is-drop-down"}`}
        data-open="true"
        style={{ maxHeight: menuPosition.maxHeight }}
      >
        <div className="drop-submenu-title">
          <span>{items[0]?.parent ? "Drop into" : "Subfolders"}</span>
        </div>
        <ScrollArea
          ref={viewportRef}
          className="drop-submenu-scroll"
          viewportClassName="drop-submenu-viewport"
          contentClassName="drop-submenu-content"
          scrollbarVariant="nav"
        >
          {items.map((item) => (
            <div
              key={item.path}
              className="drop-submenu-item"
              data-drop-kind="tab-destination"
              data-drop-path={item.path}
              data-drop-tab-id={hostTabId}
              data-drop-target={activePath === item.path ? "true" : "false"}
            >
              {item.parent && <ChevronUpIcon className="drop-submenu-parent-icon" />}
              <span className="drop-submenu-item-name">{item.name}</span>
            </div>
          ))}
          {loading && <div className="drop-submenu-status">Loading folders...</div>}
        </ScrollArea>
      </div>
    </div>,
    document.body,
  );
};
