// Tracks pending scroll requests for virtualized views.
import { useCallback, useRef, useState } from "react";

export type ScrollAlignment = "nearest" | "center";

export type ScrollRequest = {
  index: number;
  nonce: number;
  scopeKey?: string;
  alignment?: ScrollAlignment;
};

export const useScrollRequest = () => {
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);
  const scrollNonceRef = useRef(0);

  const requestScrollToIndex = useCallback((index: number, scopeKey?: string, alignment?: ScrollAlignment) => {
    scrollNonceRef.current += 1;
    setScrollRequest({ index, nonce: scrollNonceRef.current, scopeKey, alignment });
  }, []);

  return { scrollRequest, requestScrollToIndex };
};
