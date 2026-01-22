import { useEffect, useRef } from "react";
import type { RefObject } from "react";

type ScrollRequest = { index: number; nonce: number } | null | undefined;

type UseScrollToIndexOptions = {
  itemCount: number;
  rowHeight: number;
  itemsPerRow?: number;
  scrollRequest?: ScrollRequest;
};

export const useScrollToIndex = (
  ref: RefObject<HTMLElement | null>,
  { itemCount, rowHeight, itemsPerRow = 1, scrollRequest }: UseScrollToIndexOptions,
) => {
  const scrollNonceRef = useRef(0);

  useEffect(() => {
    if (!scrollRequest) return;
    if (scrollRequest.nonce === scrollNonceRef.current) return;
    const element = ref.current;
    if (!element || itemCount === 0 || rowHeight <= 0) return;
    scrollNonceRef.current = scrollRequest.nonce;

    const maxIndex = Math.max(0, itemCount - 1);
    const targetIndex = Math.min(scrollRequest.index, maxIndex);
    const columns = Math.max(1, itemsPerRow);
    const targetRow = Math.floor(targetIndex / columns);
    const targetTop = targetRow * rowHeight;
    const targetBottom = targetTop + rowHeight;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + element.clientHeight;

    if (targetTop < viewTop) {
      element.scrollTop = targetTop;
    } else if (targetBottom > viewBottom) {
      element.scrollTop = targetBottom - element.clientHeight;
    }
  }, [itemCount, itemsPerRow, ref, rowHeight, scrollRequest]);
};
