// Handles the two-tap Tab gesture for a single file view.
import { useCallback, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { isEditableElement } from "@/lib";

const DOUBLE_TAP_MS = 280;

export function useSmartTabJump(viewRef: RefObject<HTMLElement | null>, resetKey?: string | null) {
  const lastTapRef = useRef<number | null>(null);
  useLayoutEffect(() => { lastTapRef.current = null; }, [resetKey]);

  return useCallback((event: KeyboardEvent) => {
    const lastTap = lastTapRef.current;
    lastTapRef.current = null;
    if (event.defaultPrevented || event.key !== "Tab" || event.repeat || event.isComposing) return false;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;

    const active = document.activeElement;
    const view = viewRef.current;
    if (!view || !document.hasFocus() || isEditableElement(active)) return false;
    if (active && active !== document.body && active !== document.documentElement &&
        !view.contains(active) && !active.closest(".topstack, .bottom-pane")) return false;

    const now = performance.now();
    if (lastTap === null || now - lastTap > DOUBLE_TAP_MS) {
      // Let a single Tab advance focus normally. Only a completed jump owns the keystroke.
      lastTapRef.current = now;
      return false;
    }

    const scrollHost = view.querySelector<HTMLElement>(".list-body, .thumb-viewport");
    if (!scrollHost) return false;
    const maxScrollTop = scrollHost.scrollHeight - scrollHost.clientHeight;
    if (maxScrollTop <= 0) return false;

    // A focused row can disappear from the virtualized view after the jump.
    view.focus({ preventScroll: true });
    scrollHost.scrollTop = scrollHost.scrollTop < maxScrollTop / 2 ? maxScrollTop : 0;
    return true;
  }, [viewRef]);
}
