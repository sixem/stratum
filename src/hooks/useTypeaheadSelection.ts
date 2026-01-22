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

const findBestMatch = (items: TypeaheadItem[], query: string) => {
  let fallback: TypeaheadItem | null = null;
  for (const item of items) {
    if (item.label.startsWith(query)) return item;
    if (!fallback && item.label.includes(query)) {
      fallback = item;
    }
  }
  return fallback;
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
  const onMatchRef = useRef(onMatch);
  const delayRef = useRef(resetDelayMs);
  const shouldHandleRef = useRef<UseTypeaheadSelectionOptions["shouldHandle"]>(shouldHandle);

  useEffect(() => {
    bufferRef.current = "";
    lastTypeRef.current = 0;
  }, resetKeys);

  useEffect(() => {
    itemsRef.current = items;
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

      const match = findBestMatch(itemsRef.current, query);
      if (!match) return;

      onMatchRef.current(match);
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
};
