// Tracks pending scroll requests for virtualized views.
import { useCallback, useRef, useState } from "react";

type ScrollRequest = { index: number; nonce: number; scopeKey?: string } | null;

export const useScrollRequest = () => {
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest>(null);
  const scrollNonceRef = useRef(0);

  const requestScrollToIndex = useCallback((index: number, scopeKey?: string) => {
    scrollNonceRef.current += 1;
    setScrollRequest({ index, nonce: scrollNonceRef.current, scopeKey });
  }, []);

  return { scrollRequest, requestScrollToIndex };
};
