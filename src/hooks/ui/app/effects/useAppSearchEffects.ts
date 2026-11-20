// Search-field sync and filtered reload effects for the active tab.
// This keeps the typing/search lifecycle separate from unrelated window and scroll work.
import { useEffect, useRef } from "react";
import { useDirectoryFilter } from "@/hooks/domain/filesystem/useDirectoryFilter";
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

  useDirectoryFilter({
    activeTabPath, currentPath, activeSearch, deferredSearchValue, sortState, loading, loadDir,
  });
};
