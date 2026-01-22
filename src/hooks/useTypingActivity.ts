// Tracks recent typing so expensive work can pause during keyboard input.
import { useEffect, useRef, useState } from "react";

type UseTypingActivityOptions = {
  resetDelayMs?: number;
  shouldHandle?: (event: KeyboardEvent) => boolean;
};

const DEFAULT_RESET_MS = 320;

export const useTypingActivity = (options: UseTypingActivityOptions = {}) => {
  const { resetDelayMs = DEFAULT_RESET_MS, shouldHandle } = options;
  const [active, setActive] = useState(false);
  const activeRef = useRef(active);
  const timerRef = useRef<number | null>(null);
  const delayRef = useRef(resetDelayMs);
  const shouldHandleRef = useRef<UseTypingActivityOptions["shouldHandle"]>(shouldHandle);

  useEffect(() => {
    delayRef.current = resetDelayMs;
  }, [resetDelayMs]);

  useEffect(() => {
    shouldHandleRef.current = shouldHandle;
  }, [shouldHandle]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const markActive = () => {
      if (!activeRef.current) {
        activeRef.current = true;
        setActive(true);
      }
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        activeRef.current = false;
        setActive(false);
        timerRef.current = null;
      }, delayRef.current);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing) return;
      if (shouldHandleRef.current && !shouldHandleRef.current(event)) return;

      const key = event.key;
      const isTypingKey = key.length === 1 || key === "Backspace" || key === "Delete";
      if (!isTypingKey) return;

      markActive();
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      activeRef.current = false;
    };
  }, []);

  return active;
};
