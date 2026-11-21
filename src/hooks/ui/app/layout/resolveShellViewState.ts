// Resolves the shared tab/view state used by the shell sections.
// Keeping this derivation in one place prevents navigation, view, and overlays
// from re-implementing the same path, loading, and scroll-reset rules.
import type { MutableRefObject } from "react";
import type { useFileManager } from "@/hooks/domain/filesystem";
import type { useSettings, useTabSession } from "@/hooks/domain/session";
import { folderPathKey, getParentPath } from "@/lib";

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
  const { currentPath, parentPath, entries, totalCount } = fileManager;
  const {
    activeTabId,
    activeTab,
    restoringTabs,
    displayPath: viewPath,
    displaySearch,
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
  const crumbTrailPath = activeTab?.crumbTrailPath ?? viewPath;
  const viewPathKey = folderPathKey(viewPath);
  const currentPathKey = folderPathKey(currentPath);
  // File actions require the displayed folder to match the committed listing.
  // Refreshing that same listing leaves its rows and selection usable.
  const viewLoading = Boolean(viewPathKey) && (restoringTabs || viewPathKey !== currentPathKey);
  const cachedView =
    viewLoading
      ? fileManager.peekDirCache(viewPath, { sort: sortState, search: displaySearch })
      : null;
  const viewEntries = viewLoading ? cachedView?.entries ?? [] : entries;
  const viewTotalCount = viewLoading ? cachedView?.totalCount ?? 0 : totalCount;
  const viewParentPathBase = viewLoading
    ? cachedView?.parentPath ?? getParentPath(viewPath)
    : parentPath;
  const sidebarOpen = settings.sidebarOpen;
  const canGoUp = Boolean(viewParentPathBase && folderPathKey(viewParentPathBase) !== viewPathKey);
  const showLander = !viewPath.trim();
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
