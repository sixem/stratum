import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import type { ScrollRequest } from "./useScrollRequest";

type UseScrollToIndexOptions = {
  itemCount: number;
  rowHeight: number;
  rowGap?: number;
  insetTop?: number;
  itemsPerRow?: number;
  scrollRequest?: ScrollRequest | null;
  scrollKey?: string;
  ready?: boolean;
};

export const useScrollToIndex = (
  ref: RefObject<HTMLElement | null>,
  {
    itemCount,
    rowHeight,
    rowGap = 0,
    insetTop = 0,
    itemsPerRow = 1,
    scrollRequest,
    scrollKey,
    ready = true,
  }: UseScrollToIndexOptions,
) => {
  const scrollNonceRef = useRef(0);

  // Run from virtualization's layout pass so it reads the new offset before paint.
  return useCallback(() => {
    if (!ready || !scrollRequest) return;
    // Ignore stale scroll requests that were created for a different view.
    if (scrollRequest.scopeKey && scrollRequest.scopeKey !== scrollKey) return;
    if (scrollRequest.nonce === scrollNonceRef.current) return;
    const element = ref.current;
    if (!element || itemCount === 0 || rowHeight <= 0) return;
    const viewportHeight = element.clientHeight;
    if (viewportHeight <= 0) return;
    scrollNonceRef.current = scrollRequest.nonce;

    const maxIndex = Math.max(0, itemCount - 1);
    const targetIndex = Math.min(scrollRequest.index, maxIndex);
    const columns = Math.max(1, itemsPerRow);
    const targetRow = Math.floor(targetIndex / columns);
    const targetTop = insetTop + targetRow * (rowHeight + rowGap);
    const targetBottom = targetTop + rowHeight;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + viewportHeight;

    // Keep a little context around a search match, even in a short split pane.
    if (scrollRequest.alignment === "center") {
      const margin = Math.min(rowHeight, viewportHeight / 8);
      if (targetTop < viewTop + margin || targetBottom > viewBottom - margin) {
        // In a short grid pane, keep the card's filename in view.
        element.scrollTop = rowHeight > viewportHeight
          ? targetBottom - viewportHeight
          : targetTop + (rowHeight - viewportHeight) / 2;
      }
    } else if (targetTop < viewTop) {
      element.scrollTop = targetTop;
    } else if (targetBottom > viewBottom) {
      element.scrollTop = targetBottom - viewportHeight;
    }
  }, [insetTop, itemCount, itemsPerRow, ready, ref, rowGap, rowHeight, scrollKey, scrollRequest]);
};
