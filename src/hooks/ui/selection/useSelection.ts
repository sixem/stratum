import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type UseSelectionOptions = {
  items: string[];
  resetKey: string;
  indexMap?: Map<string, number>;
};

export const useSelection = ({ items, resetKey, indexMap }: UseSelectionOptions) => {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectedRef = useRef<Set<string>>(new Set());
  const anchorPathRef = useRef<string | null>(null);
  const updateSelection = useCallback((next: Set<string>) => {
    const prev = selectedRef.current;
    if (prev.size === next.size) {
      let same = true;
      for (const path of prev) {
        if (!next.has(path)) {
          same = false;
          break;
        }
      }
      if (same) {
        return;
      }
    }
    selectedRef.current = next;
    setSelected(next);
  }, []);

  // Accept a precomputed index map when the caller already has one.
  const selectionIndexMap = useMemo(() => {
    if (indexMap) return indexMap;
    // Map item -> index without allocating a temporary array.
    const map = new Map<string, number>();
    items.forEach((path, index) => {
      map.set(path, index);
    });
    return map;
  }, [indexMap, items]);

  useEffect(() => {
    if (selectedRef.current.size === 0 && !anchorPathRef.current) {
      return;
    }
    const next = new Set<string>();
    selectedRef.current = next;
    setSelected(next);
    anchorPathRef.current = null;
  }, [resetKey]);

  useEffect(() => {
    const current = selectedRef.current;
    if (current.size === 0) return;
    const next = new Set<string>();
    items.forEach((path) => {
      if (current.has(path)) {
        next.add(path);
      }
    });
    updateSelection(next);
  }, [items, updateSelection]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const clearSelection = useCallback(() => {
    const next = new Set<string>();
    selectedRef.current = next;
    setSelected(next);
    anchorPathRef.current = null;
  }, []);

  const selectItem = useCallback(
    (
      path: string,
      index: number,
      modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
    ) => {
      const isToggle = modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey;
      const isRange = modifiers.shiftKey;
      const anchorPath = anchorPathRef.current;
      const anchorIndex = anchorPath ? selectionIndexMap.get(anchorPath) : undefined;
      const current = selectedRef.current;

      let next: Set<string>;
      if (isRange && anchorIndex != null) {
        const start = Math.min(anchorIndex, index);
        const end = Math.max(anchorIndex, index);
        const range = items.slice(start, end + 1);
        next = isToggle ? new Set(current) : new Set<string>();
        range.forEach((value) => next.add(value));
      } else if (isToggle) {
        next = new Set(current);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
      } else {
        next = new Set([path]);
      }
      updateSelection(next);

      if (!isRange) {
        anchorPathRef.current = path;
      } else if (!anchorPathRef.current) {
        anchorPathRef.current = path;
      }
    },
    [items, selectionIndexMap],
  );

  const setSelection = useCallback(
    (paths: string[], anchor?: string) => {
      const next = new Set<string>();
      paths.forEach((path) => {
        if (selectionIndexMap.has(path)) {
          next.add(path);
        }
      });
      updateSelection(next);
      if (anchor) {
        anchorPathRef.current = anchor;
      } else {
        anchorPathRef.current = paths[paths.length - 1] ?? null;
      }
    },
    [selectionIndexMap],
  );

  const isSelected = useCallback((path: string) => selected.has(path), [selected]);
  const getAnchorPath = useCallback(() => anchorPathRef.current, []);
  const getSelectionSnapshot = useCallback(() => selectedRef.current, []);

  return {
    selected,
    isSelected,
    clearSelection,
    selectItem,
    setSelection,
    getAnchorPath,
    getSelectionSnapshot,
  };
};
