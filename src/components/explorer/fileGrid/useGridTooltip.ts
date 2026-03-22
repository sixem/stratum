// Delegated tooltip handling for grid cards (one listener set per grid viewport).
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { FILE_TOOLTIP_DELAY_MS, TOOLTIP_EDGE_PADDING, TOOLTIP_GAP } from "@/constants";
import { buildEntryTooltip } from "@/lib";
import { useTooltipStore } from "@/modules";
import type { EntryMeta, FileEntry } from "@/types";

type UseGridTooltipOptions = {
  viewportRef: RefObject<HTMLDivElement | null>;
  entryByPath: Map<string, FileEntry>;
  entryMeta: Map<string, EntryMeta>;
  disabled: boolean;
  delayMs?: number;
};

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

export const useGridTooltip = ({
  viewportRef,
  entryByPath,
  entryMeta,
  disabled,
  delayMs = FILE_TOOLTIP_DELAY_MS,
}: UseGridTooltipOptions) => {
  const entryByPathRef = useRef(entryByPath);
  const entryMetaRef = useRef(entryMeta);
  const hoveredCardRef = useRef<HTMLElement | null>(null);
  const hoveredPathRef = useRef<string | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const delayRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const hoverSessionRef = useRef(useTooltipStore.getState().hoverSession);

  useEffect(() => {
    entryByPathRef.current = entryByPath;
  }, [entryByPath]);

  useEffect(() => {
    entryMetaRef.current = entryMeta;
  }, [entryMeta]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const clearPending = () => {
      if (delayRef.current != null) {
        window.clearTimeout(delayRef.current);
        delayRef.current = null;
      }
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const hideTooltip = () => {
      clearPending();
      useTooltipStore.getState().hideTooltip();
    };
    const resetHoverState = () => {
      hoveredCardRef.current = null;
      hoveredPathRef.current = null;
      lastPointerRef.current = null;
      hoverSessionRef.current = useTooltipStore.getState().hoverSession;
    };
    const canRenderTooltip = () => {
      if (isContextMenuOpen()) return false;
      if (document.visibilityState !== "visible") return false;
      return document.hasFocus();
    };

    if (disabled) {
      hideTooltip();
      return () => {};
    }

    const resolveTooltipText = (path: string) => {
      const entry = entryByPathRef.current.get(path);
      if (!entry || entry.isDir) return "";
      const meta = entryMetaRef.current.get(path);
      const resolvedMeta: EntryMeta | undefined =
        meta ??
        (entry.size != null || entry.modified != null
          ? {
              path,
              size: entry.size ?? null,
              modified: entry.modified ?? null,
            }
          : undefined);
      return buildEntryTooltip(entry, resolvedMeta);
    };

    const showTooltip = (
      path: string,
      anchorX: number,
      anchorY: number,
      requestId: number,
      trigger: "mouse" | "focus",
    ) => {
      if (!canRenderTooltip()) return;
      const text = resolveTooltipText(path);
      if (!text) return;
      const tooltipApi = useTooltipStore.getState();
      if (tooltipApi.nonce !== requestId) return;
      if (trigger === "mouse" && tooltipApi.blockUntilPointerMove) return;
      tooltipApi.setTooltipText(text);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = window.requestAnimationFrame(() => {
        const latest = useTooltipStore.getState();
        if (latest.nonce !== requestId) return;
        if (trigger === "mouse" && latest.blockUntilPointerMove) return;
        if (!canRenderTooltip()) return;
        const tooltipRect = tooltipApi.tooltipElement
          ? tooltipApi.tooltipElement.getBoundingClientRect()
          : ({ width: 0, height: 0 } as DOMRect);
        const left = alignAxis(anchorX, tooltipRect.width, window.innerWidth);
        const top = alignAxis(anchorY, tooltipRect.height, window.innerHeight);
        if (useTooltipStore.getState().nonce !== requestId) return;
        tooltipApi.showTooltip({ text, x: left, y: top });
      });
    };

    const resolveTooltipTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const card = target.closest<HTMLElement>("[data-grid-tooltip=\"true\"]");
      if (!card || !viewport.contains(card)) return null;
      if (card.dataset.tooltipDisabled === "true") return null;
      const path = card.dataset.path ?? "";
      if (!path) return null;
      return { card, path };
    };

    const scheduleTooltip = (
      path: string,
      anchorX: number,
      anchorY: number,
      trigger: "mouse" | "focus",
    ) => {
      clearPending();
      const store = useTooltipStore.getState();
      if (trigger === "mouse" && store.blockUntilPointerMove) return;
      const requestId = store.nonce;

      const run = () => {
        const latest = useTooltipStore.getState();
        if (latest.nonce !== requestId) return;
        if (trigger === "mouse" && latest.blockUntilPointerMove) return;
        if (!canRenderTooltip()) return;
        const nextAnchor = trigger === "mouse" ? lastPointerRef.current : null;
        const x = nextAnchor?.x ?? anchorX;
        const y = nextAnchor?.y ?? anchorY;
        if (trigger === "mouse" && hoveredPathRef.current !== path) return;
        if (trigger === "mouse" && !hoveredCardRef.current?.isConnected) return;
        showTooltip(path, x, y, requestId, trigger);
      };

      if (!delayMs) {
        run();
        return;
      }
      delayRef.current = window.setTimeout(() => {
        delayRef.current = null;
        run();
      }, delayMs);
    };

    let trackingPointer = false;
    const stopPointerTracking = () => {
      if (!trackingPointer) return;
      trackingPointer = false;
      viewport.removeEventListener("pointermove", handlePointerMove);
    };
    const startPointerTracking = () => {
      if (trackingPointer) return;
      trackingPointer = true;
      viewport.addEventListener("pointermove", handlePointerMove, { passive: true });
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!hoveredPathRef.current) return;
      const previous = lastPointerRef.current;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      const store = useTooltipStore.getState();
      if (store.blockUntilPointerMove) {
        const moved =
          !previous ||
          Math.abs(event.clientX - previous.x) + Math.abs(event.clientY - previous.y) >= 1;
        if (!moved) return;
        store.clearTooltipBlock();
        const path = hoveredPathRef.current;
        if (!path) return;
        scheduleTooltip(path, event.clientX, event.clientY, "mouse");
        return;
      }
    };

    const handlePointerOver = (event: PointerEvent) => {
      if (isContextMenuOpen()) {
        resetHoverState();
        stopPointerTracking();
        hideTooltip();
        return;
      }
      const resolved = resolveTooltipTarget(event.target);
      if (!resolved) return;
      const store = useTooltipStore.getState();
      if (hoverSessionRef.current !== store.hoverSession) {
        resetHoverState();
        hideTooltip();
      }
      if (hoveredPathRef.current === resolved.path) {
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
        return;
      }
      hoveredCardRef.current = resolved.card;
      hoveredPathRef.current = resolved.path;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      startPointerTracking();
      hideTooltip();
      if (store.blockUntilPointerMove) return;
      scheduleTooltip(resolved.path, event.clientX, event.clientY, "mouse");
    };

    const handlePointerOut = (event: PointerEvent) => {
      if (!hoveredPathRef.current) return;
      const from = resolveTooltipTarget(event.target);
      if (!from || from.path !== hoveredPathRef.current) return;
      const next = resolveTooltipTarget(event.relatedTarget);
      if (next?.path === hoveredPathRef.current) return;
      stopPointerTracking();
      resetHoverState();
      hideTooltip();
    };

    const handlePointerLeave = () => {
      stopPointerTracking();
      resetHoverState();
      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const resolved = resolveTooltipTarget(event.target);
      if (!resolved) return;
      const target = resolved.card;
      const store = useTooltipStore.getState();
      if (hoverSessionRef.current !== store.hoverSession) {
        return;
      }
      if (!target.matches(":focus-visible")) {
        return;
      }
      hoveredCardRef.current = resolved.card;
      hoveredPathRef.current = resolved.path;
      const rect = resolved.card.getBoundingClientRect();
      scheduleTooltip(resolved.path, rect.left + rect.width / 2, rect.bottom, "focus");
    };

    const handleFocusOut = () => {
      stopPointerTracking();
      resetHoverState();
      hideTooltip();
    };

    viewport.addEventListener("pointerover", handlePointerOver);
    viewport.addEventListener("pointerout", handlePointerOut);
    viewport.addEventListener("pointerleave", handlePointerLeave);
    viewport.addEventListener("focusin", handleFocusIn);
    viewport.addEventListener("focusout", handleFocusOut);

    return () => {
      stopPointerTracking();
      viewport.removeEventListener("pointerover", handlePointerOver);
      viewport.removeEventListener("pointerout", handlePointerOut);
      viewport.removeEventListener("pointerleave", handlePointerLeave);
      viewport.removeEventListener("focusin", handleFocusIn);
      viewport.removeEventListener("focusout", handleFocusOut);
      resetHoverState();
      hideTooltip();
    };
  }, [delayMs, disabled, viewportRef]);
};
