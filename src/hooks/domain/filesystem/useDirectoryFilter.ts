// Refresh the active folder with the tab's filter without blocking navigation.
import { useEffect } from "react";
import { folderPathKey } from "@/lib";
import type { SortState } from "@/types";
import type { LoadDirOptions } from "./fileManager.types";

type Options = {
  activeTabPath: string | null;
  currentPath: string;
  activeSearch: string;
  deferredSearchValue: string;
  sortState: SortState;
  loading: boolean;
  loadDir: (path: string, options?: LoadDirOptions) => Promise<void>;
};

export const useDirectoryFilter = ({
  activeTabPath,
  currentPath,
  activeSearch,
  deferredSearchValue,
  sortState,
  loading,
  loadDir,
}: Options) => {
  useEffect(() => {
    if (!currentPath || loading || deferredSearchValue !== activeSearch) return;
    const currentKey = folderPathKey(currentPath);
    if (!currentKey || currentKey !== folderPathKey(activeTabPath ?? currentPath)) return;

    const reload = () => {
      void loadDir(currentPath, { sort: sortState, search: deferredSearchValue, silent: true });
    };
    if (!deferredSearchValue.trim()) {
      reload();
      return;
    }

    // Wait briefly for more typing and cancel if the active tab changes.
    const timer = window.setTimeout(reload, 110);
    return () => window.clearTimeout(timer);
  }, [
    activeSearch, activeTabPath, currentPath, deferredSearchValue, loadDir, loading, sortState,
  ]);
};
