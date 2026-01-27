import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

type ElementSize = {
  width: number;
  height: number;
};

export const useElementSize = (ref: RefObject<HTMLElement | null>) => {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateSize = () => {
      setSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return size;
};
