// Keeps anchored overlays in sync with layout changes from resize, scroll, and ResizeObserver.
import type { RefObject } from "react";
import { useEffect } from "react";

type ObserveRef = RefObject<Element | null>;

type UseOverlayAutoUpdateOptions = {
  enabled: boolean;
  onUpdate: () => void;
  observeRefs?: ObserveRef[];
  watchResize?: boolean;
  watchScroll?: boolean;
  scrollCapture?: boolean;
  watchElementResize?: boolean;
};

export const useOverlayAutoUpdate = ({
  enabled,
  onUpdate,
  observeRefs = [],
  watchResize = true,
  watchScroll = false,
  scrollCapture = true,
  watchElementResize = true,
}: UseOverlayAutoUpdateOptions) => {
  useEffect(() => {
    if (!enabled) return;

    if (watchResize) {
      window.addEventListener("resize", onUpdate);
    }

    if (watchScroll) {
      window.addEventListener("scroll", onUpdate, scrollCapture);
    }

    const observer =
      watchElementResize && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => onUpdate())
        : null;

    observeRefs.forEach((ref) => {
      if (ref.current) {
        observer?.observe(ref.current);
      }
    });

    return () => {
      if (watchResize) {
        window.removeEventListener("resize", onUpdate);
      }
      if (watchScroll) {
        window.removeEventListener("scroll", onUpdate, scrollCapture);
      }
      observer?.disconnect();
    };
  }, [
    enabled,
    observeRefs,
    onUpdate,
    scrollCapture,
    watchElementResize,
    watchResize,
    watchScroll,
  ]);
};
