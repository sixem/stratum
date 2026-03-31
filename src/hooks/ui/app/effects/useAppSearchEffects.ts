// Search-field sync and filtered reload effects for the active tab.
// This keeps the typing/search lifecycle separate from unrelated window and scroll work.
import { useEffect, useRef } from "react";
import { normalizePath } from "@/lib";
import type { AppEffectActions, AppEffectView } from "./appEffectTypes";

type UseAppSearchEffectsOptions = Pick<
  AppEffectView,
  | "activeTabId"
  | "activeTabPath"
  | "activeSearch"
  | "searchValue"
  | "currentPath"
  | "deferredSearchValue"
  | "sortState"
  | "loading"
> &
  Pick<AppEffectActions, "setSearchValue" | "setTabSearch" | "loadDir">;

export const useAppSearchEffects = ({
  activeTabId,
  activeTabPath,
  activeSearch,
  searchValue,
  currentPath,
  deferredSearchValue,
  sortState,
  loading,
  setSearchValue,
  setTabSearch,
  loadDir,
}: UseAppSearchEffectsOptions) => {
  const searchSyncRef = useRef(false);
  const lastSearchTabIdRef = useRef<string | null>(null);
  const searchLoadTimerRef = useRef<number | null>(null);

  const clearSearchLoadTimer = () => {
    if (searchLoadTimerRef.current == null) return;
    window.clearTimeout(searchLoadTimerRef.current);
    searchLoadTimerRef.current = null;
  };

  useEffect(() => {
    if (activeTabId === lastSearchTabIdRef.current) return;
    lastSearchTabIdRef.current = activeTabId;
    // Keep the search input synced with the newly active tab's filter.
    searchSyncRef.current = true;
    setSearchValue(activeSearch);
  }, [activeSearch, activeTabId, setSearchValue]);

  useEffect(() => {
    if (!activeTabId) return;
    if (searchSyncRef.current) {
      searchSyncRef.current = false;
      return;
    }
    if (activeSearch === searchValue) return;
    setTabSearch(searchValue);
  }, [activeSearch, activeTabId, searchValue, setTabSearch]);

  useEffect(() => {
    if (!currentPath || loading) return;
    const activePath = activeTabPath ?? currentPath;
    if (!activePath) return;
    const currentKey = normalizePath(currentPath);
    const activeKey = normalizePath(activePath);
    // Only refresh when the active tab path matches the current view.
    if (!currentKey || currentKey !== activeKey) return;
    if (deferredSearchValue !== activeSearch) return;
    const runSearchLoad = () => {
      void loadDir(currentPath, {
        sort: sortState,
        search: deferredSearchValue,
        silent: true,
      });
    };

    // Slightly debounce active filtering to reduce list churn while typing.
    const hasFilter = deferredSearchValue.trim().length > 0;
    clearSearchLoadTimer();
    if (!hasFilter) {
      runSearchLoad();
      return;
    }

    searchLoadTimerRef.current = window.setTimeout(() => {
      searchLoadTimerRef.current = null;
      runSearchLoad();
    }, 110);

    return () => {
      clearSearchLoadTimer();
    };
  }, [
    activeSearch,
    activeTabPath,
    currentPath,
    deferredSearchValue,
    loadDir,
    loading,
    sortState,
  ]);

  useEffect(() => {
    return () => {
      clearSearchLoadTimer();
    };
  }, []);
};
