// Controls the view ready/fade state so layout changes do not flicker.
import { useLayoutEffect, useRef, useState } from "react";

const depsEqual = (a: unknown[] | null, b: unknown[]) => {
  if (!a || a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
};

type ViewReadyState = {
  ready: boolean;
  animate: boolean;
};

export const useViewReady = (
  loading: boolean,
  deps: unknown[],
  keepVisible = false,
): ViewReadyState => {
  const [ready, setReady] = useState(false);
  const [animate, setAnimate] = useState(false);
  const enterRafRef = useRef<number | null>(null);
  const readyRafRef = useRef<number | null>(null);
  const depsRef = useRef<unknown[] | null>(null);
  const keepVisibleRef = useRef(false);
  const loadingRef = useRef(false);

  useLayoutEffect(() => {
    const cancelRafs = () => {
      if (enterRafRef.current) {
        window.cancelAnimationFrame(enterRafRef.current);
        enterRafRef.current = null;
      }
      if (readyRafRef.current) {
        window.cancelAnimationFrame(readyRafRef.current);
        readyRafRef.current = null;
      }
    };
    const wasKeepVisible = keepVisibleRef.current;
    keepVisibleRef.current = keepVisible;
    cancelRafs();

    const wasLoading = loadingRef.current;
    loadingRef.current = loading;
    const changed = !depsEqual(depsRef.current, deps);
    depsRef.current = deps;
    // If deps changed while loading, still run the enter fade once loading ends.
    const loadingJustEnded = wasLoading && !loading;

    if (loading) {
      setAnimate(false);
      if (!keepVisible) {
        setReady(false);
      } else {
        setReady(true);
      }
      return;
    }

    if (wasKeepVisible) {
      setReady(true);
      setAnimate(false);
      return;
    }

    if (!changed && !loadingJustEnded) {
      if (!ready) {
        setReady(true);
      }
      setAnimate(false);
      return;
    }

    setReady(false);
    setAnimate(false);
    // Stage the transition so the fade-in has a frame to latch onto.
    enterRafRef.current = window.requestAnimationFrame(() => {
      enterRafRef.current = null;
      setAnimate(true);
      readyRafRef.current = window.requestAnimationFrame(() => {
        readyRafRef.current = null;
        setReady(true);
        setAnimate(false);
      });
    });

    return () => {
      cancelRafs();
    };
  }, [keepVisible, loading, ready, ...deps]);

  return { ready, animate };
};
