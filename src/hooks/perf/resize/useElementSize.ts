import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

type ElementSize = {
  width: number;
  height: number;
};

export const useElementSize = (ref: RefObject<HTMLElement | null>) => {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  const sizeRef = useRef(size);

  const commitSize = (width: number, height: number) => {
    const current = sizeRef.current;
    if (current.width === width && current.height === height) return;
    const next = { width, height };
    sizeRef.current = next;
    setSize(next);
  };

  const measure = () => {
    const element = ref.current;
    if (!element) return;
    commitSize(element.clientWidth, element.clientHeight);
  };

  useLayoutEffect(() => {
    // Measure after every render so layout-driven changes (like sidebar toggles)
    // can update sizes before paint without waiting on ResizeObserver timing.
    measure();
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return size;
};
