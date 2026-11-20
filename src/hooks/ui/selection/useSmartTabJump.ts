// Handles the two-tap Tab gesture for a single file view.
import { useCallback, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { isEditableElement } from "@/lib";

const DOUBLE_TAP_MS = 280;

export function useSmartTabJump(viewRef: RefObject<HTMLElement | null>, resetKey?: string | null) {
  const lastTapRef = useRef<number | null>(null);
  useLayoutEffect(() => { lastTapRef.current = null; }, [resetKey]);

  return useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key !== "Tab") return false;
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat) return false;

    const active = document.activeElement;
    const view = viewRef.current;
    if (!view || isEditableElement(active) || !document.hasFocus()) return false;
    if (active && active !== document.body && active !== document.documentElement && !view.contains(active)) {
      // Tab bars and toolbars can keep focus after navigation.
      view.focus({ preventScroll: true });
    }

    const now = performance.now();
    const lastTap = lastTapRef.current;
    lastTapRef.current = now;
    if (lastTap === null || now - lastTap > DOUBLE_TAP_MS) return true;

    const scrollHost = view.querySelector<HTMLElement>(".list-body, .thumb-viewport");
    if (!scrollHost) return true;
    const maxScrollTop = scrollHost.scrollHeight - scrollHost.clientHeight;
    if (maxScrollTop <= 0) return true;

    // A focused row can disappear from the virtualized view after the jump.
    view.focus({ preventScroll: true });
    scrollHost.scrollTop = scrollHost.scrollTop < maxScrollTop / 2 ? maxScrollTop : 0;
    return true;
  }, [viewRef]);
}
