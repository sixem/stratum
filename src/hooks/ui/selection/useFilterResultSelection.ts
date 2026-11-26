// Enter transfers focus once the pane shows the results for the submitted filter.
import { useCallback, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";
import type { EntryItem } from "@/lib";

type Options = {
  viewKey: string;
  filterKey: string | null;
  displayedQueryKey: string | null;
  items: readonly EntryItem[];
  paneRef: RefObject<HTMLElement | null>;
  setSelection: (paths: string[], anchor: string) => void;
  scrollToIndex: (index: number) => void;
};

export function useFilterResultSelection({
  viewKey, filterKey, displayedQueryKey, items, paneRef, setSelection, scrollToIndex,
}: Options) {
  const pending = useRef<{ viewKey: string; filterKey: string; input: HTMLInputElement } | null>(null);
  const selectFirst = useCallback(() => {
    const index = items[0]?.type === "parent" ? 1 : 0;
    const first = items[index];
    const pane = paneRef.current;
    if (first?.type !== "entry" || !pane) return;
    setSelection([first.entry.path], first.entry.path);
    pane.focus({ preventScroll: true });
    scrollToIndex(index);
  }, [items, paneRef, scrollToIndex, setSelection]);

  useLayoutEffect(() => {
    const request = pending.current;
    if (!request) return;
    if (request.viewKey !== viewKey || request.filterKey !== filterKey || document.activeElement !== request.input) {
      pending.current = null;
      return;
    }
    // A silent filter request can leave the previous rows mounted while it loads.
    if (displayedQueryKey !== request.filterKey) return;
    pending.current = null;
    selectFirst();
  }, [displayedQueryKey, filterKey, selectFirst, viewKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!filterKey || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (displayedQueryKey === filterKey) {
      pending.current = null;
      selectFirst();
    } else {
      pending.current = { viewKey, filterKey, input: event.currentTarget };
    }
  };

  const onBlur = () => { pending.current = null; };
  return { onKeyDown, onBlur };
}
