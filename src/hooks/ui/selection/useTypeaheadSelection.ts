// Tracks incremental key presses to select entries by name.
import { useEffect, useLayoutEffect, useRef } from "react";
import { isEditableElement } from "@/lib";
import type { EntryItem } from "@/lib";

export type TypeaheadItem = {
  path: string;
  index: number;
  label: string;
};

type UseTypeaheadSelectionOptions = {
  items: EntryItem[];
  onMatch: (item: TypeaheadItem) => void;
  resetKeys?: unknown[];
  resetDelayMs?: number;
  shouldHandle?: (activeElement: Element | null) => boolean;
};

const DEFAULT_RESET_MS = 700;

const buildIndex = (items: EntryItem[]) => {
  const byInitial = new Map<string, TypeaheadItem[]>();
  const all: TypeaheadItem[] = [];
  items.forEach((row, index) => {
    if (row.type === "parent") return;
    const item = { path: row.entry.path, index, label: row.entry.name.toLowerCase() };
    all.push(item);
    const first = item.label[0];
    if (!first) return;
    const bucket = byInitial.get(first);
    if (bucket) {
      bucket.push(item);
    } else {
      byInitial.set(first, [item]);
    }
  });
  return { byInitial, all };
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

const findBestMatch = ({ all, byInitial }: ReturnType<typeof buildIndex>, query: string) => {
  const candidates = byInitial.get(query[0]) ?? all;
  const match = scanForMatch(candidates, query);
  if (match || candidates === all) return match;
  return scanForMatch(all, query);
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
  const indexRef = useRef<ReturnType<typeof buildIndex> | null>(null);
  const onMatchRef = useRef(onMatch);
  const delayRef = useRef(resetDelayMs);
  const shouldHandleRef = useRef<UseTypeaheadSelectionOptions["shouldHandle"]>(shouldHandle);

  useEffect(() => {
    bufferRef.current = "";
    lastTypeRef.current = 0;
  }, resetKeys);

  useLayoutEffect(() => {
    itemsRef.current = items;
    // Most visits never use typeahead. Build its index on the first keystroke.
    indexRef.current = null;
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

      const key = event.key;
      if (key === "Escape") {
        bufferRef.current = "";
        lastTypeRef.current = 0;
        return;
      }
      // The scope check may focus the file pane. Leave navigation keys and
      // modifiers with the currently focused control (e.g. the sidebar Menu key).
      if (key !== "Backspace" && (key.length !== 1 || !key.trim())) return;
      if (key === "Backspace" && !bufferRef.current) return;
      if (shouldHandleRef.current && !shouldHandleRef.current(active)) return;

      const now = performance.now();
      if (now - lastTypeRef.current > delayRef.current) {
        bufferRef.current = "";
      }

      if (key === "Backspace") {
        if (!bufferRef.current) return;
        bufferRef.current = bufferRef.current.slice(0, -1);
      } else {
        bufferRef.current += key.toLowerCase();
      }

      lastTypeRef.current = now;
      const query = bufferRef.current.trim();
      if (!query) return;

      indexRef.current ??= buildIndex(itemsRef.current);
      const match = findBestMatch(indexRef.current, query);
      if (!match) return;

      onMatchRef.current(match);
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
};
