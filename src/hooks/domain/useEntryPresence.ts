// Tracks entry presence so added/removed items can animate without flashing the full view.
import { useEffect, useMemo, useRef, useState } from "react";
import type { EntryItem, EntryPresence } from "@/lib";

type PresenceState = {
  item: EntryItem;
  presence: EntryPresence;
  expiresAt: number | null;
};

type PresenceItem = EntryItem & {
  presence: EntryPresence;
};

type UseEntryPresenceOptions = {
  items: EntryItem[];
  resetKey: string;
  animate: boolean;
};

const FADE_IN_MS = 180;
const FADE_OUT_MS = 180;

const buildStableItems = (items: EntryItem[]) =>
  items.map((item) => ({ ...item, presence: "stable" as const }));

export const useEntryPresence = ({
  items,
  resetKey,
  animate,
}: UseEntryPresenceOptions) => {
  const [presentItems, setPresentItems] = useState<PresenceItem[]>(() =>
    buildStableItems(items),
  );
  const stateRef = useRef(new Map<string, PresenceState>());
  const prevKeysRef = useRef<string[]>([]);
  const mergedKeysRef = useRef<string[]>([]);
  const resetKeyRef = useRef(resetKey);
  const initialLoadRef = useRef(true);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const rebuildItems = (order: string[], map: Map<string, PresenceState>) => {
    const next: PresenceItem[] = [];
    order.forEach((key) => {
      const state = map.get(key);
      if (!state) return;
      next.push({ ...state.item, presence: state.presence });
    });
    setPresentItems(next);
  };

  const scheduleCleanup = () => {
    clearTimer();
    let nextExpiry: number | null = null;
    stateRef.current.forEach((state) => {
      if (state.expiresAt == null) return;
      nextExpiry =
        nextExpiry == null ? state.expiresAt : Math.min(nextExpiry, state.expiresAt);
    });
    if (nextExpiry == null) return;
    const delay = Math.max(0, nextExpiry - Date.now());
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const now = Date.now();
      let changed = false;
      stateRef.current.forEach((state, key) => {
        if (state.expiresAt == null || state.expiresAt > now) return;
        if (state.presence === "added") {
          state.presence = "stable";
          state.expiresAt = null;
          changed = true;
          return;
        }
        if (state.presence === "removed") {
          stateRef.current.delete(key);
          changed = true;
        }
      });
      if (changed) {
        mergedKeysRef.current = mergedKeysRef.current.filter((key) =>
          stateRef.current.has(key),
        );
        rebuildItems(mergedKeysRef.current, stateRef.current);
      }
      scheduleCleanup();
    }, delay);
  };

  useEffect(() => {
    const resetChanged = resetKeyRef.current !== resetKey;
    if (resetChanged) {
      resetKeyRef.current = resetKey;
      stateRef.current.clear();
      prevKeysRef.current = [];
      mergedKeysRef.current = [];
      initialLoadRef.current = true;
      clearTimer();
    }

    if (!animate) {
      stateRef.current.clear();
      prevKeysRef.current = items.map((item) => item.key);
      mergedKeysRef.current = [...prevKeysRef.current];
      initialLoadRef.current = true;
      clearTimer();
      setPresentItems(buildStableItems(items));
      return;
    }

    const now = Date.now();
    // Avoid animating the first render after a reset so the view doesn't flash.
    const allowAnimate = !initialLoadRef.current;
    const prevKeys = prevKeysRef.current;
    const prevMap = stateRef.current;
    const nextMap = new Map<string, PresenceState>();
    const nextKeys = items.map((item) => item.key);
    const nextKeySet = new Set(nextKeys);

    items.forEach((item) => {
      const isParent = item.type === "parent";
      const wasKnown = prevMap.has(item.key);
      const shouldAnimate = allowAnimate && !wasKnown && !isParent;
      nextMap.set(item.key, {
        item,
        presence: shouldAnimate ? "added" : "stable",
        expiresAt: shouldAnimate ? now + FADE_IN_MS : null,
      });
    });

    let mergedKeys = [...nextKeys];
    if (allowAnimate) {
      // Reinsert removed keys near their previous positions so layout shifts happen after fade-out.
      prevKeys.forEach((key, index) => {
        if (nextKeySet.has(key)) return;
        const previous = prevMap.get(key);
        if (!previous || previous.item.type === "parent") return;
        nextMap.set(key, {
          item: previous.item,
          presence: "removed",
          expiresAt: now + FADE_OUT_MS,
        });
        const insertIndex = Math.min(Math.max(index, 0), mergedKeys.length);
        mergedKeys.splice(insertIndex, 0, key);
      });
    }

    stateRef.current = nextMap;
    prevKeysRef.current = nextKeys;
    mergedKeysRef.current = mergedKeys;
    initialLoadRef.current = false;
    rebuildItems(mergedKeys, nextMap);
    scheduleCleanup();
  }, [animate, items, resetKey]);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  return useMemo(() => ({ items: presentItems }), [presentItems]);
};
