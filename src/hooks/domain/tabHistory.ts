// History store for per-tab navigation stacks.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tab } from "@/types";
import { normalizePath } from "@/lib";

export type TabHistory = {
  back: string[];
  forward: string[];
};

type UseTabHistoryOptions = {
  tabs: Tab[];
  activeTabId: string | null;
  limit?: number;
};

const DEFAULT_HISTORY_LIMIT = 40;

const trimHistory = (history: TabHistory, limit: number) => {
  if (history.back.length > limit) {
    history.back = history.back.slice(-limit);
  }
  if (history.forward.length > limit) {
    history.forward = history.forward.slice(-limit);
  }
};

export const useTabHistory = ({
  tabs,
  activeTabId,
  limit = DEFAULT_HISTORY_LIMIT,
}: UseTabHistoryOptions) => {
  const historyRef = useRef<Map<string, TabHistory>>(new Map());
  const [version, forceUpdate] = useState(0);

  const bump = useCallback(() => {
    forceUpdate((prev) => prev + 1);
  }, []);

  const getHistory = useCallback((tabId: string) => {
    const store = historyRef.current;
    const existing = store.get(tabId);
    if (existing) return existing;
    const created = { back: [], forward: [] };
    store.set(tabId, created);
    return created;
  }, []);

  const recordHistory = useCallback(
    (tabId: string, fromPath: string, toPath: string) => {
      const trimmedFrom = fromPath.trim();
      const trimmedTo = toPath.trim();
      if (!trimmedFrom || !trimmedTo) return;
      const fromKey = normalizePath(trimmedFrom) ?? trimmedFrom;
      const toKey = normalizePath(trimmedTo) ?? trimmedTo;
      if (!fromKey || !toKey || fromKey === toKey) return;
      const history = getHistory(tabId);
      history.back.push(trimmedFrom);
      history.forward = [];
      trimHistory(history, limit);
      bump();
    },
    [bump, getHistory, limit],
  );

  const popBack = useCallback(
    (tabId: string, currentPath: string) => {
      const history = getHistory(tabId);
      if (history.back.length === 0) return null;
      const next = history.back.pop() ?? null;
      if (!next) return null;
      const trimmedCurrent = currentPath.trim();
      if (trimmedCurrent) {
        history.forward.push(trimmedCurrent);
      }
      trimHistory(history, limit);
      bump();
      return next;
    },
    [bump, getHistory, limit],
  );

  const popForward = useCallback(
    (tabId: string, currentPath: string) => {
      const history = getHistory(tabId);
      if (history.forward.length === 0) return null;
      const next = history.forward.pop() ?? null;
      if (!next) return null;
      const trimmedCurrent = currentPath.trim();
      if (trimmedCurrent) {
        history.back.push(trimmedCurrent);
      }
      trimHistory(history, limit);
      bump();
      return next;
    },
    [bump, getHistory, limit],
  );

  const canGoBack = useMemo(() => {
    if (!activeTabId) return false;
    return Boolean(historyRef.current.get(activeTabId)?.back.length);
  }, [activeTabId, version]);

  const canGoForward = useMemo(() => {
    if (!activeTabId) return false;
    return Boolean(historyRef.current.get(activeTabId)?.forward.length);
  }, [activeTabId, version]);

  useEffect(() => {
    // Drop closed tabs from history to keep memory bounded.
    const ids = new Set(tabs.map((tab) => tab.id));
    let pruned = false;
    historyRef.current.forEach((_value, id) => {
      if (!ids.has(id)) {
        historyRef.current.delete(id);
        pruned = true;
      }
    });
    if (pruned) {
      bump();
    }
  }, [bump, tabs]);

  return {
    canGoBack,
    canGoForward,
    recordHistory,
    popBack,
    popForward,
  };
};
