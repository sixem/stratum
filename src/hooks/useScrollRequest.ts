// Tracks pending scroll requests for virtualized views.
import { useCallback, useRef, useState } from "react";

type ScrollRequest = { index: number; nonce: number } | null;

export const useScrollRequest = () => {
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest>(null);
  const scrollNonceRef = useRef(0);

  const requestScrollToIndex = useCallback((index: number) => {
    scrollNonceRef.current += 1;
    setScrollRequest({ index, nonce: scrollNonceRef.current });
  }, []);

  return { scrollRequest, requestScrollToIndex };
};
