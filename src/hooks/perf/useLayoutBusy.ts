import { useEffect, useRef, useState } from "react";

type LayoutBusyOptions = {
  width: number;
  itemCount: number;
  threshold?: number;
  widthDelta?: number;
  delayMs?: number;
};

export const useLayoutBusy = ({
  width,
  itemCount,
  threshold = 500,
  widthDelta = 4,
  delayMs = 200,
}: LayoutBusyOptions) => {
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<number | null>(null);
  const lastWidthRef = useRef(0);

  useEffect(() => {
    if (!width) {
      setBusy(false);
      return;
    }

    const lastWidth = lastWidthRef.current;
    lastWidthRef.current = width;

    if (itemCount < threshold) {
      setBusy(false);
      return;
    }

    if (!lastWidth || Math.abs(width - lastWidth) < widthDelta) {
      return;
    }

    setBusy(true);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setBusy(false);
    }, delayMs);
  }, [delayMs, itemCount, threshold, width, widthDelta]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return busy;
};
