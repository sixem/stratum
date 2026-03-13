// Buffers range input changes so the thumb stays smooth while the parent draft
// tree updates at animation-frame cadence.
import { startTransition, useCallback, useEffect, useRef, useState } from "react";

export const useBufferedRangeValue = (
  committedValue: number,
  onCommit: (next: number) => void,
) => {
  const [value, setValue] = useState(committedValue);
  const committedValueRef = useRef(committedValue);
  const frameRef = useRef<number | null>(null);
  const pendingValueRef = useRef<number | null>(null);

  useEffect(() => {
    committedValueRef.current = committedValue;
    if (pendingValueRef.current === committedValue) {
      pendingValueRef.current = null;
    }
    if (pendingValueRef.current != null) {
      return;
    }
    setValue(committedValue);
  }, [committedValue]);

  const flushPendingValue = useCallback(() => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const pendingValue = pendingValueRef.current;
    if (pendingValue == null || pendingValue === committedValueRef.current) {
      return;
    }
    pendingValueRef.current = null;
    startTransition(() => {
      onCommit(pendingValue);
    });
  }, [onCommit]);

  const scheduleValue = useCallback(
    (next: number) => {
      setValue(next);
      pendingValueRef.current = next;
      if (frameRef.current != null) {
        return;
      }
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        flushPendingValue();
      });
    },
    [flushPendingValue],
  );

  useEffect(() => {
    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return {
    value,
    setValue: scheduleValue,
    flushPendingValue,
  };
};
