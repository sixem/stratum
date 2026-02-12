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

export const useGridTooltip = ({
  viewportRef,
  entryByPath,
  entryMeta,
  disabled,
  delayMs = FILE_TOOLTIP_DELAY_MS,
}: UseGridTooltipOptions) => {
  const entryByPathRef = useRef(entryByPath);
  const entryMetaRef = useRef(entryMeta);
  const hoveredPathRef = useRef<string | null>(null);
  const hoverMovedRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const delayRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

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
    ) => {
      const text = resolveTooltipText(path);
      if (!text) return;
      const tooltipApi = useTooltipStore.getState();
      if (tooltipApi.nonce !== requestId) return;
      tooltipApi.setTooltipText(text);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = window.requestAnimationFrame(() => {
        const latest = useTooltipStore.getState();
        if (latest.nonce !== requestId) return;
        const tooltipRect = tooltipApi.tooltipElement
          ? tooltipApi.tooltipElement.getBoundingClientRect()
          : ({ width: 0, height: 0 } as DOMRect);
        const left = alignAxis(anchorX, tooltipRect.width, window.innerWidth);
        const top = alignAxis(anchorY, tooltipRect.height, window.innerHeight);
        if (useTooltipStore.getState().nonce !== requestId) return;
        tooltipApi.showTooltip({ text, x: left, y: top });
      });
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
        if (document.visibilityState !== "visible") return;
        if (trigger === "mouse" && !document.hasFocus()) return;
        const nextAnchor = trigger === "mouse" ? lastPointerRef.current : null;
        const x = nextAnchor?.x ?? anchorX;
        const y = nextAnchor?.y ?? anchorY;
        showTooltip(path, x, y, requestId);
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

    const resolveTooltipTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const card = target.closest<HTMLElement>("[data-grid-tooltip=\"true\"]");
      if (!card || !viewport.contains(card)) return null;
      if (card.dataset.tooltipDisabled === "true") return null;
      const path = card.dataset.path ?? "";
      if (!path) return null;
      return { card, path };
    };

    const handleMouseMove = (event: MouseEvent) => {
      const resolved = resolveTooltipTarget(event.target);
      const previous = lastPointerRef.current;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      const moved =
        !previous ||
        Math.abs(event.clientX - previous.x) + Math.abs(event.clientY - previous.y) >= 1;

      const store = useTooltipStore.getState();
      if (moved && store.blockUntilPointerMove) {
        store.clearTooltipBlock();
      }

      if (!resolved) {
        hoveredPathRef.current = null;
        hoverMovedRef.current = false;
        hideTooltip();
        return;
      }

      if (hoveredPathRef.current !== resolved.path) {
        hoveredPathRef.current = resolved.path;
        hoverMovedRef.current = false;
        hideTooltip();
      }

      if (!moved || hoverMovedRef.current) return;
      hoverMovedRef.current = true;
      scheduleTooltip(resolved.path, event.clientX, event.clientY, "mouse");
    };

    const handleMouseLeave = () => {
      hoveredPathRef.current = null;
      hoverMovedRef.current = false;
      lastPointerRef.current = null;
      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const resolved = resolveTooltipTarget(event.target);
      if (!resolved) return;
      hoveredPathRef.current = resolved.path;
      hoverMovedRef.current = false;
      const rect = resolved.card.getBoundingClientRect();
      scheduleTooltip(resolved.path, rect.left + rect.width / 2, rect.bottom, "focus");
    };

    const handleFocusOut = () => {
      hoveredPathRef.current = null;
      hoverMovedRef.current = false;
      hideTooltip();
    };

    viewport.addEventListener("mousemove", handleMouseMove);
    viewport.addEventListener("mouseleave", handleMouseLeave);
    viewport.addEventListener("focusin", handleFocusIn);
    viewport.addEventListener("focusout", handleFocusOut);

    return () => {
      viewport.removeEventListener("mousemove", handleMouseMove);
      viewport.removeEventListener("mouseleave", handleMouseLeave);
      viewport.removeEventListener("focusin", handleFocusIn);
      viewport.removeEventListener("focusout", handleFocusOut);
      hoveredPathRef.current = null;
      hoverMovedRef.current = false;
      lastPointerRef.current = null;
      hideTooltip();
    };
  }, [delayMs, disabled, viewportRef]);
};
