// Tracks incremental key presses to select entries by name.
import { useEffect, useRef } from "react";
import { isEditableElement } from "@/lib";

export type TypeaheadItem = {
  path: string;
  index: number;
  label: string;
};

type UseTypeaheadSelectionOptions = {
  items: TypeaheadItem[];
  onMatch: (item: TypeaheadItem) => void;
  resetKeys?: unknown[];
  resetDelayMs?: number;
  shouldHandle?: (activeElement: Element | null) => boolean;
};

const DEFAULT_RESET_MS = 700;

type TypeaheadIndex = Map<string, TypeaheadItem[]>;

const buildIndex = (items: TypeaheadItem[]): TypeaheadIndex => {
  const index = new Map<string, TypeaheadItem[]>();
  items.forEach((item) => {
    const first = item.label[0];
    if (!first) return;
    const bucket = index.get(first);
    if (bucket) {
      bucket.push(item);
    } else {
      index.set(first, [item]);
    }
  });
  return index;
};

const scanForMatch = (items: TypeaheadItem[], query: string) => {
  let fallback: TypeaheadItem | null = null;
  for (const item of items) {
    if (item.label.startsWith(query)) return item;
    if (!fallback && item.label.includes(query)) {
      fallback = item;
    }
  }
  return fallback;
};

const findBestMatch = (items: TypeaheadItem[], index: TypeaheadIndex, query: string) => {
  const first = query[0];
  const candidates = first ? index.get(first) ?? items : items;
  const match = scanForMatch(candidates, query);
  if (match || candidates === items) return match;
  return scanForMatch(items, query);
};

export const useTypeaheadSelection = ({
  items,
  onMatch,
  resetKeys = [],
  resetDelayMs = DEFAULT_RESET_MS,
  shouldHandle,
}: UseTypeaheadSelectionOptions) => {
  const bufferRef = useRef("");
  const lastTypeRef = useRef(0);
  const itemsRef = useRef(items);
  const indexRef = useRef<TypeaheadIndex>(buildIndex(items));
  const onMatchRef = useRef(onMatch);
  const delayRef = useRef(resetDelayMs);
  const shouldHandleRef = useRef<UseTypeaheadSelectionOptions["shouldHandle"]>(shouldHandle);

  useEffect(() => {
    bufferRef.current = "";
    lastTypeRef.current = 0;
  }, resetKeys);

  useEffect(() => {
    itemsRef.current = items;
    // Index by first letter to keep scan work sub-linear for large folders.
    indexRef.current = buildIndex(items);
  }, [items]);

  useEffect(() => {
    onMatchRef.current = onMatch;
  }, [onMatch]);

  useEffect(() => {
    delayRef.current = resetDelayMs;
  }, [resetDelayMs]);

  useEffect(() => {
    shouldHandleRef.current = shouldHandle;
  }, [shouldHandle]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing) return;
      if (event.repeat) return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;
      if (shouldHandleRef.current && !shouldHandleRef.current(active)) return;

      const key = event.key;
      if (key === "Escape") {
        bufferRef.current = "";
        lastTypeRef.current = 0;
        return;
      }

      const now = performance.now();
      if (now - lastTypeRef.current > delayRef.current) {
        bufferRef.current = "";
      }

      if (key === "Backspace") {
        if (!bufferRef.current) return;
        bufferRef.current = bufferRef.current.slice(0, -1);
      } else if (key.length === 1) {
        if (key.trim().length === 0) return;
        bufferRef.current += key.toLowerCase();
      } else {
        return;
      }

      lastTypeRef.current = now;
      const query = bufferRef.current.trim();
      if (!query) return;

      const match = findBestMatch(itemsRef.current, indexRef.current, query);
      if (!match) return;

      onMatchRef.current(match);
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
};
