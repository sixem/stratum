// Dampens virtualized overscan briefly after view changes to reduce commit cost.
import { useEffect, useRef, useState } from "react";

type DynamicOverscanOptions = {
  resetKey: string;
  base: number;
  min?: number;
  warmupMs?: number;
};

export const useDynamicOverscan = ({
  resetKey,
  base,
  min = 1,
  warmupMs = 140,
}: DynamicOverscanOptions) => {
  const [overscan, setOverscan] = useState(base);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastKeyRef.current === resetKey) return;
    const nextMin = Math.min(min, base);
    lastKeyRef.current = resetKey;
    if (base <= nextMin) {
      setOverscan(base);
      return;
    }
    setOverscan(nextMin);
    const timer = window.setTimeout(() => {
      setOverscan(base);
    }, warmupMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [base, min, resetKey, warmupMs]);

  return overscan;
};
