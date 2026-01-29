import { useLayoutEffect } from "react";
import type { RefObject } from "react";

// Keeps a CSS variable synced with a fixed element height.
export const useCssVarHeight = (ref: RefObject<HTMLElement | null>, cssVar: string) => {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateHeight = () => {
      document.documentElement.style.setProperty(cssVar, `${element.offsetHeight}px`);
    };

    updateHeight();
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(element);
    return () => observer.disconnect();
  }, [cssVar, ref]);
};
