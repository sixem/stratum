// Each mounted pane owns its display slots. File actions keep using live entries.
import { useCallback, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { useSettingsStore } from "@/modules/settings.store";
import { useEntryPresence } from "@/hooks/domain/metadata/useEntryPresence";
import type { EntryItem } from "@/lib/entryItems";
import type { SortState } from "@/types";
import type { ScrollRequest } from "@/hooks/perf/scroll/useScrollRequest";
import { reconcileRemovals, releaseVisibleRemovals, type RemovalLayout } from "@/lib/deferredRemovals";
import { VIEW_INSET } from "./constants";

type Snapshot = RemovalLayout & { scope: string; live: EntryItem[] };
export function useDeferredRemovals(view: { items: EntryItem[]; removalScope: string; sortState: SortState; remote?: boolean;
  loading: boolean; scrollRequest?: ScrollRequest | null }, animate: boolean) {
  const enabled = useSettingsStore(s => s.deferOffscreenRemovals) && !view.loading;
  const { items: live, removalScope: scope } = view;
  const { items: animated } = useEntryPresence({ items: live, resetKey: scope, animate: !enabled && !view.loading && animate });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  // Reconcile before children see the new listing, including when a name reappears.
  if (enabled && (snapshot?.live !== live || snapshot.scope !== scope)) {
    const layout = snapshot?.scope === scope
      ? reconcileRemovals(snapshot.rows, live, view.sortState, view.remote)
      : { rows: live, pending: 0 };
    setSnapshot({ ...layout, live, scope });
  } else if (!enabled && snapshot) setSnapshot(null);
  const rows = enabled ? snapshot?.rows ?? live : animated;
  const pending = enabled && Boolean(snapshot?.pending);
  const release = useCallback((top: number, height: number, stride: number, rowHeight: number, columns: number) => {
    setSnapshot(current => {
      if (!current || current.scope !== scope) return current;
      const next = releaseVisibleRemovals(current, top, height, stride, rowHeight, columns, VIEW_INSET);
      return next === current ? current : { ...current, ...next };
    });
  }, [scope]);
  const scrollRequest = useMemo(() => {
    const request = view.scrollRequest;
    if (!request || !pending) return request;
    const key = live[request.index]?.key;
    const index = rows.findIndex(item => item.key === key);
    return index < 0 ? null : { ...request, index };
  }, [view.scrollRequest, pending, live, rows]);
  return { rows, pending, release, scrollRequest };
}

export function useRemovalViewport(model: ReturnType<typeof useDeferredRemovals>, ref: RefObject<HTMLDivElement | null>,
  stride: number, rowHeight: number, columns = 1) {
  const { rows, pending, release } = model;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !pending) return;
    const check = () => release(el.scrollTop, el.clientHeight, stride, rowHeight, columns);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => { el.removeEventListener("scroll", check); observer.disconnect(); };
  }, [ref, pending, rows, stride, rowHeight, columns, release]);
}
