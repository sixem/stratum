import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { makeDebug } from "@/lib";

type UseScrollPositionOptions = {
  scrollKey: string;
  initialTop: number;
  onScrollTopChange: (key: string, scrollTop: number) => void;
  onRestore?: (key: string, scrollTop: number) => void;
  restoreReady?: boolean;
};

const MAX_RESTORE_ATTEMPTS = 6;
const log = makeDebug("scroll:restore");

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
  const restoreRafRef = useRef<number | null>(null);
  const restoreAttemptsRef = useRef(0);
  const lastKeyRef = useRef<string | null>(null);
  const restoredKeyRef = useRef<string | null>(null);
  const restoringKeyRef = useRef<string | null>(null);
  const suppressPersistRef = useRef(false);
  const lastScrollTopByKeyRef = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (lastKeyRef.current !== scrollKey) {
      if (log.enabled) {
        log("key change: %s -> %s", lastKeyRef.current ?? "none", scrollKey);
      }
      lastKeyRef.current = scrollKey;
      restoredKeyRef.current = null;
      restoringKeyRef.current = null;
    }

    if (!restoreReady) {
      if (restoreRafRef.current != null) {
        window.cancelAnimationFrame(restoreRafRef.current);
        restoreRafRef.current = null;
      }
      suppressPersistRef.current = false;
      if (log.enabled) {
        log("restore blocked: key=%s ready=no", scrollKey);
      }
      return;
    }

    if (restoredKeyRef.current === scrollKey) {
      return;
    }

    const targetTop = Math.max(0, Math.round(initialTop));
    restoreAttemptsRef.current = 0;
    restoringKeyRef.current = scrollKey;
    // Avoid persisting scroll while we are restoring and layout is still settling.
    suppressPersistRef.current = true;
    if (log.enabled) {
      log("restore start: key=%s target=%d", scrollKey, targetTop);
    }

    const attemptRestore = () => {
      if (restoringKeyRef.current !== scrollKey) return;
      if (!restoreReady) return;
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const nextTop = Math.min(targetTop, maxScrollTop);
      element.scrollTop = nextTop;
      const delta = Math.abs(element.scrollTop - nextTop);
      const canRetry = targetTop > maxScrollTop;
      const shouldRetry =
        canRetry && restoreAttemptsRef.current < MAX_RESTORE_ATTEMPTS && delta > 0.5;
      if (log.enabled) {
        log(
          "restore attempt: key=%s target=%d max=%d applied=%d retry=%s attempt=%d",
          scrollKey,
          targetTop,
          maxScrollTop,
          element.scrollTop,
          shouldRetry ? "yes" : "no",
          restoreAttemptsRef.current,
        );
      }
      if (shouldRetry) {
        restoreAttemptsRef.current += 1;
        restoreRafRef.current = window.requestAnimationFrame(() => {
          restoreRafRef.current = null;
          attemptRestore();
        });
        return;
      }
      suppressPersistRef.current = false;
      lastScrollTopByKeyRef.current.set(scrollKey, element.scrollTop);
      onScrollTopChange(scrollKey, element.scrollTop);
      if (onRestore) {
        onRestore(scrollKey, element.scrollTop);
      }
      restoredKeyRef.current = scrollKey;
      if (log.enabled) {
        log("restore done: key=%s final=%d", scrollKey, element.scrollTop);
      }
    };

    attemptRestore();
  }, [
    initialTop,
    onRestore,
    onScrollTopChange,
    ref,
    restoreReady,
    scrollKey,
  ]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const effectKey = scrollKey;

    const handleScroll = () => {
      if (suppressPersistRef.current) return;
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        if (suppressPersistRef.current) return;
        lastScrollTopByKeyRef.current.set(scrollKey, element.scrollTop);
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
      if (restoreRafRef.current != null) {
        window.cancelAnimationFrame(restoreRafRef.current);
        restoreRafRef.current = null;
      }
      const lastTop = lastScrollTopByKeyRef.current.get(effectKey) ?? 0;
      onScrollTopChange(effectKey, lastTop);
      suppressPersistRef.current = false;
    };
  }, [onScrollTopChange, ref, scrollKey]);
};
