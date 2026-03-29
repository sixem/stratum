// Resolves the shared tab/view state used by the shell sections.
// Keeping this derivation in one place prevents navigation, view, and overlays
// from re-implementing the same path, loading, and scroll-reset rules.
import type { MutableRefObject } from "react";
import type { useFileManager } from "@/hooks/domain/filesystem";
import type { useSettings, useTabSession } from "@/hooks/domain/session";
import { normalizePath } from "@/lib";

type FileManagerModel = ReturnType<typeof useFileManager>;
type SettingsModel = ReturnType<typeof useSettings>;
type TabSessionModel = ReturnType<typeof useTabSession>;

type ResolveShellViewStateOptions = {
  fileManager: FileManagerModel;
  settings: SettingsModel;
  tabSession: TabSessionModel;
  lastViewRef: MutableRefObject<{ tabId: string | null; pathKey: string } | null>;
};

export const resolveShellViewState = ({
  fileManager,
  settings,
  tabSession,
  lastViewRef,
}: ResolveShellViewStateOptions) => {
  const { currentPath, parentPath, entries, totalCount, loading } = fileManager;
  const {
    activeTabId,
    activeTab,
    viewMode,
    sortState,
    tabs,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  } = tabSession;

  const activeSearch = activeTab?.search ?? "";
  const activeTabPath = activeTab?.path ?? "";
  const viewPath = activeTabPath || currentPath;
  const crumbTrailPath = activeTab?.crumbTrailPath ?? viewPath;
  const viewPathKey = normalizePath(viewPath ?? "");
  const currentPathKey = normalizePath(currentPath);
  const viewPending = Boolean(viewPathKey) && viewPathKey !== currentPathKey;
  const cachedView =
    viewPending && viewPathKey
      ? fileManager.peekDirCache(viewPath, { sort: sortState, search: activeSearch })
      : null;
  const viewLoading = viewPending ? loading && !cachedView : loading;
  const viewEntries = viewPending ? cachedView?.entries ?? [] : entries;
  const viewTotalCount = viewPending ? cachedView?.totalCount ?? 0 : totalCount;
  const viewParentPathBase = viewPending ? cachedView?.parentPath ?? null : parentPath;
  const sidebarOpen = settings.sidebarOpen;
  const canGoUp = Boolean(parentPath && parentPath !== currentPath);
  const showLander = !viewPath.trim() && !viewLoading;
  const viewKey = `${activeTabId ?? "none"}:${viewPathKey}`;
  const lastView = lastViewRef.current;
  const shouldResetScroll =
    lastView?.tabId === activeTabId && lastView?.pathKey !== viewPathKey;
  const scrollRestoreTop = shouldResetScroll
    ? 0
    : activeTabId
      ? activeTab?.scrollTop ?? 0
      : 0;

  return {
    activeTabId,
    activeTab,
    activeSearch,
    activeTabPath,
    viewMode,
    sortState,
    tabs,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    viewPath,
    crumbTrailPath,
    viewPathKey,
    viewLoading,
    viewEntries,
    viewTotalCount,
    viewParentPathBase,
    sidebarOpen,
    canGoUp,
    showLander,
    viewKey,
    shouldResetScroll,
    scrollRestoreTop,
  };
};
