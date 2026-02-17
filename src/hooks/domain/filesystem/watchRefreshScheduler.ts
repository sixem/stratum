// Pure scheduler transitions for directory-watch refresh state.
import { normalizePath } from "@/lib";
import type { Tab } from "@/types";

export type WatchRefreshSchedulerState = {
  dirtyTabIds: Set<string>;
  renameDirtyTabIds: Set<string>;
  lastRefreshByTabId: Map<string, number>;
  refreshInFlight: boolean;
  refreshQueued: boolean;
  suppressNextRefresh: boolean;
};

export type EvaluateRefreshContext = {
  enabled: boolean;
  activeTabId: string | null;
  activeTabPath: string;
  currentPath: string;
  loading: boolean;
  now: number;
  refreshCooldownMs: number;
};

export type EvaluateRefreshResult =
  | {
      kind: "start";
      tabId: string;
      viewPath: string;
      suppressPresence: boolean;
    }
  | { kind: "queue" }
  | { kind: "mark-dirty"; tabId: string }
  | { kind: "noop" };

export const createWatchRefreshSchedulerState = (): WatchRefreshSchedulerState => ({
  dirtyTabIds: new Set<string>(),
  renameDirtyTabIds: new Set<string>(),
  lastRefreshByTabId: new Map<string, number>(),
  refreshInFlight: false,
  refreshQueued: false,
  suppressNextRefresh: false,
});

export const evaluateActiveRefresh = (
  state: WatchRefreshSchedulerState,
  context: EvaluateRefreshContext,
): EvaluateRefreshResult => {
  if (!context.enabled) return { kind: "noop" };
  const tabId = context.activeTabId;
  const viewPath = context.activeTabPath.trim();
  if (!tabId || !viewPath) return { kind: "noop" };
  if (context.loading) {
    state.refreshQueued = true;
    return { kind: "queue" };
  }

  const viewKey = normalizePath(viewPath);
  const currentKey = normalizePath(context.currentPath);
  if (!viewKey || viewKey !== currentKey) {
    state.dirtyTabIds.add(tabId);
    return { kind: "mark-dirty", tabId };
  }

  const lastRefresh = state.lastRefreshByTabId.get(tabId) ?? 0;
  if (context.now - lastRefresh < context.refreshCooldownMs) {
    state.refreshQueued = true;
    return { kind: "queue" };
  }

  if (state.refreshInFlight) {
    state.refreshQueued = true;
    return { kind: "queue" };
  }

  state.refreshInFlight = true;
  state.refreshQueued = false;
  state.lastRefreshByTabId.set(tabId, context.now);
  state.dirtyTabIds.delete(tabId);
  const suppressPresence =
    state.suppressNextRefresh || state.renameDirtyTabIds.has(tabId);
  if (suppressPresence) {
    state.suppressNextRefresh = false;
    state.renameDirtyTabIds.delete(tabId);
  }

  return {
    kind: "start",
    tabId,
    viewPath,
    suppressPresence,
  };
};

export const finishRefreshRun = (state: WatchRefreshSchedulerState) => {
  state.refreshInFlight = false;
  if (!state.refreshQueued) return false;
  state.refreshQueued = false;
  return true;
};

type ConsumePendingChangesContext = {
  pendingPaths: string[];
  renamePaths: string[];
  activeTabId: string | null;
  activeTabPath: string;
  tabs: Tab[];
};

export type PendingChangeResult = {
  shouldRefreshActive: boolean;
};

export const consumePendingChanges = (
  state: WatchRefreshSchedulerState,
  context: ConsumePendingChangesContext,
): PendingChangeResult => {
  const renameKeys = new Set<string>();
  context.renamePaths.forEach((path) => {
    const key = normalizePath(path);
    if (key) {
      renameKeys.add(key);
    }
  });

  const activeKey = normalizePath(context.activeTabPath);
  let shouldRefreshActive = false;
  let shouldSuppressActive = false;

  context.pendingPaths.forEach((rawPath) => {
    const key = normalizePath(rawPath);
    if (!key) return;
    const isRename = renameKeys.has(key);
    context.tabs.forEach((tab) => {
      const tabKey = normalizePath(tab.path);
      if (!tabKey || tabKey !== key) return;
      if (tab.id === context.activeTabId && activeKey === key) {
        shouldRefreshActive = true;
        if (isRename) {
          shouldSuppressActive = true;
        }
      } else {
        state.dirtyTabIds.add(tab.id);
        if (isRename) {
          state.renameDirtyTabIds.add(tab.id);
        }
      }
    });
  });

  if (shouldSuppressActive) {
    state.suppressNextRefresh = true;
  }

  return { shouldRefreshActive };
};

export const consumeQueuedRefreshWhenIdle = (
  state: WatchRefreshSchedulerState,
  enabled: boolean,
  loading: boolean,
) => {
  if (!enabled || loading || !state.refreshQueued) return false;
  state.refreshQueued = false;
  return true;
};

export const shouldRefreshOnTabSwitch = (
  state: WatchRefreshSchedulerState,
  activeTabId: string | null,
  now: number,
  refreshCooldownMs: number,
) => {
  if (!activeTabId) return false;
  const isDirty = state.dirtyTabIds.has(activeTabId);
  const lastRefresh = state.lastRefreshByTabId.get(activeTabId) ?? 0;
  return isDirty || now - lastRefresh > refreshCooldownMs;
};

export const markActiveTabSynced = (
  state: WatchRefreshSchedulerState,
  activeTabId: string | null,
  activeTabPath: string,
  currentPath: string,
  now: number,
) => {
  if (!activeTabId) return;
  const viewKey = normalizePath(activeTabPath);
  const currentKey = normalizePath(currentPath);
  if (!viewKey || viewKey !== currentKey) return;
  state.dirtyTabIds.delete(activeTabId);
  state.renameDirtyTabIds.delete(activeTabId);
  state.lastRefreshByTabId.set(activeTabId, now);
};

export const pruneSchedulerTabs = (
  state: WatchRefreshSchedulerState,
  tabs: Tab[],
) => {
  const ids = new Set(tabs.map((tab) => tab.id));
  state.dirtyTabIds.forEach((id) => {
    if (!ids.has(id)) {
      state.dirtyTabIds.delete(id);
    }
  });
  state.renameDirtyTabIds.forEach((id) => {
    if (!ids.has(id)) {
      state.renameDirtyTabIds.delete(id);
    }
  });
  state.lastRefreshByTabId.forEach((_value, id) => {
    if (!ids.has(id)) {
      state.lastRefreshByTabId.delete(id);
    }
  });
};
