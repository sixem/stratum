// Window the override list inside the modal's shared scroller. The single
// expanded editor can add height without changing the positions of earlier rows.
import { useLayoutEffect, useRef, useState } from "react";

export const CONVERSION_OVERRIDE_ROW_HEIGHT = 32;
const OVERSCAN = 6;

const rowAtOffset = (offset: number, expandedEnd: number, extraHeight: number) => {
  const rowOffset = offset < expandedEnd ? offset : Math.max(expandedEnd - 1, offset - extraHeight);
  return Math.floor(rowOffset / CONVERSION_OVERRIDE_ROW_HEIGHT);
};

export const useConversionOverrideWindow = (itemCount: number, expandedIndex: number) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const expandedRowRef = useRef<HTMLDivElement | null>(null);
  const [range, setRange] = useState({ start: 0, end: 0, extraHeight: 0 });

  useLayoutEffect(() => {
    const list = listRef.current;
    const viewport = list?.closest<HTMLElement>(".conversion-scroll-body");
    if (!list || !viewport) return;

    const expandedRow = expandedRowRef.current;
    let frame = 0;
    const measure = () => {
      const extraHeight = expandedRow
        ? Math.max(0, expandedRow.offsetHeight - CONVERSION_OVERRIDE_ROW_HEIGHT)
        : 0;
      const expandedEnd = (expandedIndex + 1) * CONVERSION_OVERRIDE_ROW_HEIGHT;
      const top = viewport.getBoundingClientRect().top + viewport.clientTop - list.getBoundingClientRect().top;
      const start = Math.min(itemCount, Math.max(0, rowAtOffset(top, expandedEnd, extraHeight) - OVERSCAN));
      // Mount the first rows even below the viewport so Tab can reach the list.
      const lastVisible = Math.max(0, rowAtOffset(top + viewport.clientHeight, expandedEnd, extraHeight));
      const end = Math.min(itemCount, lastVisible + OVERSCAN + 1);
      setRange((current) => current.start === start && current.end === end && current.extraHeight === extraHeight
        ? current : { start, end, extraHeight });
    };
    const scheduleMeasure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(viewport);
    // A form section can resize and move the list even with a fixed viewport.
    for (const section of viewport.children) resizeObserver.observe(section);
    if (expandedRow) resizeObserver.observe(expandedRow);
    viewport.addEventListener("scroll", scheduleMeasure, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      viewport.removeEventListener("scroll", scheduleMeasure);
    };
  }, [expandedIndex, itemCount]);

  useLayoutEffect(() => {
    const expandedRow = expandedRowRef.current;
    if (!expandedRow) return;
    const frame = window.requestAnimationFrame(() => {
      expandedRow.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedIndex]);

  return { listRef, expandedRowRef, ...range };
};
