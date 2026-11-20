// Tracks incremental key presses to select entries by name.
import { useCallback, useLayoutEffect, useRef } from "react";
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
  useLayoutEffect(() => {
    bufferRef.current = "";
    lastTypeRef.current = 0;
  }, resetKeys);

  useLayoutEffect(() => {
    itemsRef.current = items;
    // Most visits never use typeahead. Build its index on the first keystroke.
    indexRef.current = null;
  }, [items]);

  return useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.isComposing || event.repeat) return false;

    const active = document.activeElement;
    if (isEditableElement(active)) return false;

    const { key } = event;
    if (key === "Escape") {
      bufferRef.current = "";
      lastTypeRef.current = 0;
      return false;
    }
    // The scope check may focus the file pane. Leave navigation keys with the focused control.
    const isBackspace = key === "Backspace";
    if (!isBackspace && (key.length !== 1 || !key.trim())) return false;

    const now = performance.now();
    if (now - lastTypeRef.current > resetDelayMs) bufferRef.current = "";
    if (isBackspace && !bufferRef.current) return false;
    if (shouldHandle && !shouldHandle(active)) return false;

    bufferRef.current = isBackspace ? bufferRef.current.slice(0, -1) : bufferRef.current + key.toLowerCase();
    lastTypeRef.current = now;
    const query = bufferRef.current;
    if (!query) return isBackspace;

    indexRef.current ??= buildIndex(itemsRef.current);
    const match = findBestMatch(indexRef.current, query);
    if (match) onMatch(match);
    // Backspace edits a live query even when the shortened query has no match.
    return Boolean(match) || isBackspace;
  }, [onMatch, resetDelayMs, shouldHandle]);
};
