// Provides a lightweight "now" ticker for time-sensitive UI.
// Useful for keeping elapsed times and rates fresh while a view is open.
import { useEffect, useState } from "react";

type UseNowTickOptions = {
  enabled: boolean;
  intervalMs?: number;
};

export const useNowTick = ({ enabled, intervalMs = 1000 }: UseNowTickOptions) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const tick = () => {
      if (!active) return;
      setNow(Date.now());
    };
    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs]);

  return now;
};
