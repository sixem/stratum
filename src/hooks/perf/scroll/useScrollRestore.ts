// Restores a stored scroll offset once the view is ready to render at full height.
import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

type UseScrollRestoreOptions = {
  restoreKey: string;
  restoreTop: number;
  restoreReady?: boolean;
};

const MAX_RESTORE_ATTEMPTS = 6;

export const useScrollRestore = (
  ref: RefObject<HTMLElement | null>,
  { restoreKey, restoreTop, restoreReady = true }: UseScrollRestoreOptions,
) => {
  const restoredKeyRef = useRef<string | null>(null);
  const restoreRafRef = useRef<number | null>(null);
  const restoreAttemptsRef = useRef(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!restoreReady) return;
    if (restoredKeyRef.current === restoreKey) return;

    const targetTop = Math.max(0, Math.round(restoreTop));
    restoreAttemptsRef.current = 0;

    const attemptRestore = () => {
      if (!ref.current || restoredKeyRef.current === restoreKey) return;
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const nextTop = Math.min(targetTop, maxScrollTop);
      element.scrollTop = nextTop;
      const canRetry = targetTop > maxScrollTop;
      const shouldRetry =
        canRetry && restoreAttemptsRef.current < MAX_RESTORE_ATTEMPTS;
      if (shouldRetry) {
        restoreAttemptsRef.current += 1;
        restoreRafRef.current = window.requestAnimationFrame(() => {
          restoreRafRef.current = null;
          attemptRestore();
        });
        return;
      }
      restoredKeyRef.current = restoreKey;
    };

    attemptRestore();
    return () => {
      if (restoreRafRef.current != null) {
        window.cancelAnimationFrame(restoreRafRef.current);
        restoreRafRef.current = null;
      }
    };
  }, [ref, restoreKey, restoreReady, restoreTop]);
};
