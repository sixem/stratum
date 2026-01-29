import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

const DEFAULT_SETTLE_MS = 160;

export const useScrollSettled = (
  ref: RefObject<HTMLElement | null>,
  settleMs: number = DEFAULT_SETTLE_MS,
) => {
  const [scrolling, setScrolling] = useState(false);
  const timerRef = useRef<number | null>(null);
  const scrollingRef = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const stop = () => {
      scrollingRef.current = false;
      setScrolling(false);
      timerRef.current = null;
    };

    const handle = () => {
      if (!scrollingRef.current) {
        scrollingRef.current = true;
        setScrolling(true);
      }
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(stop, settleMs);
    };

    element.addEventListener("scroll", handle, { passive: true });
    element.addEventListener("wheel", handle, { passive: true });

    return () => {
      element.removeEventListener("scroll", handle);
      element.removeEventListener("wheel", handle);
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      scrollingRef.current = false;
    };
  }, [ref, settleMs]);

  return scrolling;
};
