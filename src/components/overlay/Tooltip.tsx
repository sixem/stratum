// Tooltip overlay and wrapper helpers.
import type { FocusEvent, HTMLAttributes, MouseEvent, ReactElement } from "react";
import { Children, cloneElement, useCallback, useEffect, useRef } from "react";
import { shallow } from "zustand/shallow";
import { useSettingsStore, useTooltipStore } from "@/modules";
import { TOOLTIP_EDGE_PADDING, TOOLTIP_GAP } from "@/constants";
import { alignFloatingAxis, getViewportSize } from "./overlayUtils";
import { useOverlayDismiss } from "./useOverlayDismiss";

const OPEN_CONTEXT_MENU = '.context-menu[data-open="true"]';

export const TooltipDisplay = () => {
  const enabled = useSettingsStore((state) => state.showTooltips);
  const tooltipState = useTooltipStore(
    (state) => ({
      visible: state.visible,
      text: state.text,
      x: state.x,
      y: state.y,
      inContextMenu: Boolean(state.anchor?.closest(OPEN_CONTEXT_MENU)),
    }),
    shallow,
  );
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const setTooltipElement = useTooltipStore((state) => state.setTooltipElement);
  const hideTooltip = useTooltipStore((state) => state.hideTooltip);
  const blockTooltips = useTooltipStore((state) => state.blockTooltips);
  const bumpHoverSession = useTooltipStore((state) => state.bumpHoverSession);
  const tooltipText = tooltipState.text ?? "";

  useEffect(() => {
    setTooltipElement(tooltipRef.current);
    return () => {
      setTooltipElement(null);
    };
  }, [setTooltipElement]);

  useEffect(() => {
    if (!enabled) hideTooltip();
  }, [enabled, hideTooltip]);

  const handleTooltipViewportDismiss = () => {
    hideTooltip();
    blockTooltips();
  };

  useOverlayDismiss({
    enabled,
    onEscape: hideTooltip,
    onScroll: handleTooltipViewportDismiss,
    onResize: hideTooltip,
    onPointerDown: hideTooltip,
    keydownCapture: true,
    pointerDownCapture: true,
  });

  useEffect(() => {
    const handleWindowBlur = () => {
      hideTooltip();
      blockTooltips();
      bumpHoverSession();
    };
    const handleWindowFocus = () => {
      hideTooltip();
      blockTooltips();
      bumpHoverSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        hideTooltip();
        blockTooltips();
        bumpHoverSession();
      }
    };
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [blockTooltips, bumpHoverSession, hideTooltip]);

  return (
    <div
      ref={tooltipRef}
      className={`tooltip${enabled && tooltipState.visible ? " is-visible" : ""}`}
      data-context-menu={tooltipState.inContextMenu || undefined}
      style={{ transform: `translate3d(${tooltipState.x}px, ${tooltipState.y}px, 0)` }}
    >
      {tooltipText}
    </div>
  );
};

type TooltipWrapperProps = {
  text: string;
  disabled?: boolean;
  delayMs?: number;
  withinContextMenu?: boolean;
  children: ReactElement;
};

export const TooltipWrapper = ({
  text,
  disabled = false,
  delayMs,
  withinContextMenu = false,
  children,
}: TooltipWrapperProps) => {
  const child = Children.only(children) as ReactElement<HTMLAttributes<Element>>;
  const rafRef = useRef<number | null>(null);
  const delayRef = useRef<number | null>(null);
  const anchorRef = useRef<Element | null>(null);
  // Only show hover tooltips after a real pointer move inside the element.
  const hoveredRef = useRef(false);
  const hoveredElementRef = useRef<Element | null>(null);
  const hoverMovedRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const hoverSessionRef = useRef(useTooltipStore.getState().hoverSession);

  const clearPendingTooltip = useCallback(() => {
    if (delayRef.current != null) {
      window.clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // A search result can disappear without dispatching mouse leave or blur.
  useEffect(() => () => {
    clearPendingTooltip();
    const tooltip = useTooltipStore.getState();
    if (anchorRef.current && tooltip.anchor === anchorRef.current) {
      tooltip.hideTooltip();
    }
  }, [clearPendingTooltip]);

  const resetHoverState = () => {
    hoveredRef.current = false;
    hoveredElementRef.current = null;
    hoverMovedRef.current = false;
    lastPointerRef.current = null;
    hoverSessionRef.current = useTooltipStore.getState().hoverSession;
  };

  const canRenderTooltip = (anchor: Element) => {
    if (!useSettingsStore.getState().showTooltips) return false;
    if (withinContextMenu ? !anchor.closest(OPEN_CONTEXT_MENU) : document.querySelector(OPEN_CONTEXT_MENU)) return false;
    if (document.visibilityState !== "visible") return false;
    return document.hasFocus();
  };

  const showTooltip = (
    anchor: Element,
    anchorX: number,
    anchorY: number,
    requestId: number,
    trigger: "mouse" | "focus",
  ) => {
    if (disabled || !text) return;
    if (!canRenderTooltip(anchor)) return;

    const tooltipApi = useTooltipStore.getState();
    if (tooltipApi.nonce !== requestId) return;
    if (trigger === "mouse" && tooltipApi.blockUntilPointerMove) return;
    tooltipApi.setTooltipText(text);

    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const latest = useTooltipStore.getState();
      if (latest.nonce !== requestId || !anchor.isConnected) return;
      if (trigger === "mouse" && latest.blockUntilPointerMove) return;
      if (!canRenderTooltip(anchor)) return;
      const tooltipEl = tooltipApi.tooltipElement;
      const tooltipRect = tooltipEl
        ? tooltipEl.getBoundingClientRect()
        : ({ width: 0, height: 0 } as DOMRect);
      const viewport = getViewportSize();

      // Align to cursor, flipping when close to edges.
      const left = alignFloatingAxis(
        anchorX,
        tooltipRect.width,
        viewport.width,
        TOOLTIP_EDGE_PADDING,
        TOOLTIP_GAP,
      );
      const top = alignFloatingAxis(
        anchorY,
        tooltipRect.height,
        viewport.height,
        TOOLTIP_EDGE_PADDING,
        TOOLTIP_GAP,
      );

      if (useTooltipStore.getState().nonce !== requestId) return;
      tooltipApi.showTooltip({ text, x: left, y: top, anchor });
    });
  };

  const isPointerStillInsideHovered = (x: number, y: number) => {
    if (!hoveredRef.current) return false;
    const hovered = hoveredElementRef.current;
    if (!hovered || !hovered.isConnected) return false;
    const pointerTarget = document.elementFromPoint(x, y);
    if (!pointerTarget) return false;
    return hovered.contains(pointerTarget);
  };

  const scheduleTooltip = (
    anchor: Element,
    anchorX: number,
    anchorY: number,
    trigger: "mouse" | "focus",
  ) => {
    if (disabled || !text) {
      return;
    }

    if (delayRef.current) {
      window.clearTimeout(delayRef.current);
      delayRef.current = null;
    }

    const store = useTooltipStore.getState();
    if (trigger === "mouse" && store.blockUntilPointerMove) {
      return;
    }
    const requestId = store.nonce;
    const delayValue = delayMs ?? store.tooltipDelay;
    anchorRef.current = anchor;
    const resolveAnchor = () => {
      if (trigger !== "mouse") {
        return { x: anchorX, y: anchorY };
      }
      const latest = lastPointerRef.current;
      if (!latest) {
        return { x: anchorX, y: anchorY };
      }
      return { x: latest.x, y: latest.y };
    };
    const run = () => {
      const latest = useTooltipStore.getState();
      if (latest.nonce !== requestId) return;
      if (trigger === "mouse" && latest.blockUntilPointerMove) return;
      if (!canRenderTooltip(anchor)) return;
      const nextAnchor = resolveAnchor();
      if (trigger === "mouse" && !isPointerStillInsideHovered(nextAnchor.x, nextAnchor.y)) {
        return;
      }
      showTooltip(anchor, nextAnchor.x, nextAnchor.y, requestId, trigger);
    };

    if (!delayValue) {
      run();
      return;
    }

    delayRef.current = window.setTimeout(() => {
      delayRef.current = null;
      run();
    }, delayValue);
  };

  const hideTooltip = () => {
    clearPendingTooltip();
    useTooltipStore.getState().hideTooltip();
  };

  const props = {
    onMouseEnter: (event: MouseEvent) => {
      child.props.onMouseEnter?.(event);
      hoverSessionRef.current = useTooltipStore.getState().hoverSession;
      hoveredRef.current = true;
      hoveredElementRef.current = event.currentTarget as Element;
      hoverMovedRef.current = false;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
    },
    onMouseMove: (event: MouseEvent) => {
      child.props.onMouseMove?.(event);
      if (!canRenderTooltip(event.currentTarget)) return;
      const store = useTooltipStore.getState();
      if (hoverSessionRef.current !== store.hoverSession) {
        resetHoverState();
        hoveredRef.current = true;
        hoveredElementRef.current = event.currentTarget as Element;
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
        return;
      }
      if (!hoveredRef.current) return;
      const last = lastPointerRef.current;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      if (!last) return;
      const moved =
        Math.abs(event.clientX - last.x) + Math.abs(event.clientY - last.y) >= 1;
      if (!moved) return;
      if (store.blockUntilPointerMove) {
        store.clearTooltipBlock();
      }
      if (hoverMovedRef.current) return;
      hoverMovedRef.current = true;
      scheduleTooltip(event.currentTarget as Element, event.clientX, event.clientY, "mouse");
    },
    onMouseLeave: (event: MouseEvent) => {
      child.props.onMouseLeave?.(event);
      resetHoverState();
      hideTooltip();
    },
    onFocus: (event: FocusEvent) => {
      child.props.onFocus?.(event);
      const target = event.currentTarget as HTMLElement | null;
      if (target && canRenderTooltip(target)) {
        const store = useTooltipStore.getState();
        if (hoverSessionRef.current !== store.hoverSession) {
          return;
        }
        if (!target.matches(":focus-visible")) {
          return;
        }
        const rect = target.getBoundingClientRect();
        scheduleTooltip(target, rect.left + rect.width / 2, rect.bottom, "focus");
      }
    },
    onBlur: (event: FocusEvent) => {
      child.props.onBlur?.(event);
      resetHoverState();
      hideTooltip();
    },
  };

  return cloneElement(child, props);
};
