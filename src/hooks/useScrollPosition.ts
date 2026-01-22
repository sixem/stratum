import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

type UseScrollPositionOptions = {
  scrollKey: string;
  initialTop: number;
  onScrollTopChange: (key: string, scrollTop: number) => void;
  onRestore?: (key: string, scrollTop: number) => void;
  restoreReady?: boolean;
};

export const useScrollPosition = (
  ref: RefObject<HTMLElement | null>,
  {
    scrollKey,
    initialTop,
    onScrollTopChange,
    onRestore,
    restoreReady = true,
  }: UseScrollPositionOptions,
) => {
  const rafRef = useRef<number | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const restoredKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (lastKeyRef.current !== scrollKey) {
      lastKeyRef.current = scrollKey;
      restoredKeyRef.current = null;
    }

    if (!restoreReady) {
      return;
    }

    if (restoredKeyRef.current === scrollKey) {
      return;
    }

    const targetTop = Math.max(0, Math.round(initialTop));
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const nextTop = Math.min(targetTop, maxScrollTop);
    element.scrollTop = nextTop;
    onScrollTopChange(scrollKey, nextTop);
    if (onRestore) {
      onRestore(scrollKey, nextTop);
    }
    restoredKeyRef.current = scrollKey;
  }, [initialTop, onRestore, onScrollTopChange, ref, restoreReady, scrollKey]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        onScrollTopChange(scrollKey, element.scrollTop);
      });
    };

    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", handleScroll);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [onScrollTopChange, ref, scrollKey]);
};
