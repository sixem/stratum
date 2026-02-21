// Tooltip overlay and wrapper helpers.
import type { FocusEvent, HTMLAttributes, MouseEvent, ReactElement } from "react";
import { Children, cloneElement, useEffect, useRef } from "react";
import { shallow } from "zustand/shallow";
import { useTooltipStore } from "@/modules";
import { TOOLTIP_EDGE_PADDING, TOOLTIP_GAP } from "@/constants";

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const alignAxis = (anchor: number, size: number, viewport: number) => {
  const maxStart = viewport - TOOLTIP_EDGE_PADDING - size;
  const minStart = TOOLTIP_EDGE_PADDING;

  if (anchor + TOOLTIP_GAP + size <= viewport - TOOLTIP_EDGE_PADDING) {
    return anchor + TOOLTIP_GAP;
  }
  if (anchor - TOOLTIP_GAP - size >= TOOLTIP_EDGE_PADDING) {
    return anchor - TOOLTIP_GAP - size;
  }

  return clamp(anchor - size / 2, minStart, maxStart);
};

const isContextMenuOpen = () =>
  Boolean(document.querySelector(".context-menu[data-open=\"true\"]"));

export const TooltipDisplay = () => {
  const tooltipState = useTooltipStore(
    (state) => ({
      visible: state.visible,
      text: state.text,
      x: state.x,
      y: state.y,
    }),
    shallow,
  );
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const setTooltipElement = useTooltipStore((state) => state.setTooltipElement);
  const hideTooltip = useTooltipStore((state) => state.hideTooltip);
  const blockTooltips = useTooltipStore((state) => state.blockTooltips);
  const bumpHoverSession = useTooltipStore((state) => state.bumpHoverSession);
  const tooltipText = tooltipState.text ?? "";
  const isMultiline = tooltipText.includes("\n");

  useEffect(() => {
    setTooltipElement(tooltipRef.current);
    return () => {
      setTooltipElement(null);
    };
  }, [setTooltipElement]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideTooltip();
      }
    };

    const handleScroll = () => {
      hideTooltip();
      blockTooltips();
    };
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
    const handleResize = () => hideTooltip();
    const handlePointer = () => hideTooltip();

    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("resize", handleResize);
    window.addEventListener("pointerdown", handlePointer, true);

    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointerdown", handlePointer, true);
    };
  }, [blockTooltips, bumpHoverSession, hideTooltip]);

  return (
    <div
      ref={tooltipRef}
      className={`tooltip${tooltipState.visible ? " is-visible" : ""}${
        isMultiline ? " is-multiline" : " is-singleline"
      }`}
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
  children: ReactElement;
};

export const TooltipWrapper = ({
  text,
  disabled = false,
  delayMs,
  children,
}: TooltipWrapperProps) => {
  const child = Children.only(children) as ReactElement<HTMLAttributes<Element>>;
  const rafRef = useRef<number | null>(null);
  const delayRef = useRef<number | null>(null);
  // Only show hover tooltips after a real pointer move inside the element.
  const hoveredRef = useRef(false);
  const hoveredElementRef = useRef<Element | null>(null);
  const hoverMovedRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const hoverSessionRef = useRef(useTooltipStore.getState().hoverSession);

  const resetHoverState = () => {
    hoveredRef.current = false;
    hoveredElementRef.current = null;
    hoverMovedRef.current = false;
    lastPointerRef.current = null;
    hoverSessionRef.current = useTooltipStore.getState().hoverSession;
  };

  const canRenderTooltip = () => {
    if (isContextMenuOpen()) return false;
    if (document.visibilityState !== "visible") return false;
    return document.hasFocus();
  };

  const showTooltip = (
    anchorX: number,
    anchorY: number,
    requestId: number,
    trigger: "mouse" | "focus",
  ) => {
    if (disabled || !text) return;
    if (!canRenderTooltip()) return;

    const tooltipApi = useTooltipStore.getState();
    if (tooltipApi.nonce !== requestId) return;
    if (trigger === "mouse" && tooltipApi.blockUntilPointerMove) return;
    tooltipApi.setTooltipText(text);

    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = window.requestAnimationFrame(() => {
      const latest = useTooltipStore.getState();
      if (latest.nonce !== requestId) return;
      if (trigger === "mouse" && latest.blockUntilPointerMove) return;
      if (!canRenderTooltip()) return;
      const tooltipEl = tooltipApi.tooltipElement;
      const tooltipRect = tooltipEl
        ? tooltipEl.getBoundingClientRect()
        : ({ width: 0, height: 0 } as DOMRect);
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Align to cursor, flipping when close to edges.
      const left = alignAxis(anchorX, tooltipRect.width, viewportWidth);
      const top = alignAxis(anchorY, tooltipRect.height, viewportHeight);

      if (useTooltipStore.getState().nonce !== requestId) return;
      tooltipApi.showTooltip({ text, x: left, y: top });
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
      if (!canRenderTooltip()) return;
      const nextAnchor = resolveAnchor();
      if (trigger === "mouse" && !isPointerStillInsideHovered(nextAnchor.x, nextAnchor.y)) {
        return;
      }
      showTooltip(nextAnchor.x, nextAnchor.y, requestId, trigger);
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
    if (delayRef.current) {
      window.clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
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
      if (isContextMenuOpen()) return;
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
      scheduleTooltip(event.clientX, event.clientY, "mouse");
    },
    onMouseLeave: (event: MouseEvent) => {
      child.props.onMouseLeave?.(event);
      resetHoverState();
      hideTooltip();
    },
    onFocus: (event: FocusEvent) => {
      child.props.onFocus?.(event);
      const target = event.currentTarget as HTMLElement | null;
      if (target) {
        const store = useTooltipStore.getState();
        if (hoverSessionRef.current !== store.hoverSession) {
          return;
        }
        if (!target.matches(":focus-visible")) {
          return;
        }
        const rect = target.getBoundingClientRect();
        scheduleTooltip(rect.left + rect.width / 2, rect.bottom, "focus");
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
