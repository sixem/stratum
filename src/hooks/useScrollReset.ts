import { useEffect } from "react";
import type { RefObject } from "react";

export const useScrollReset = (ref: RefObject<HTMLElement | null>, deps: unknown[]) => {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.scrollTop = 0;
  }, [ref, ...deps]);
};
