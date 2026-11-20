import { useCallback, useEffect, useMemo, useState } from "react";

export type BeginFileActivity = (label: string) => () => void;

export const useFileActivity = () => {
  const [message, setMessage] = useState<string | null>(null);
  const timers = useMemo(() => new Set<number>(), []);
  const visible = useMemo(() => new Map<symbol, string>(), []);

  useEffect(() => () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    visible.clear();
  }, [timers, visible]);

  const beginFileActivity = useCallback<BeginFileActivity>((label) => {
    const id = Symbol();
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      visible.set(id, label);
      setMessage(visible.values().next().value ?? null);
    }, 180);
    timers.add(timer);

    return () => {
      if (timers.delete(timer)) window.clearTimeout(timer);
      if (visible.delete(id)) setMessage(visible.values().next().value ?? null);
    };
  }, [timers, visible]);

  return { message, beginFileActivity };
};
