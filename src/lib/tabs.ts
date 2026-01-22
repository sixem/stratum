// Tab creation helpers with default view settings.
import type { SortState, Tab, ViewMode } from "@/types";
import { DEFAULT_SORT } from "./sort";

export const DEFAULT_TAB_STATE = {
  viewMode: "thumbs" as ViewMode,
  sidebarOpen: true,
  sort: { ...DEFAULT_SORT },
};

// Creates a new tab with defaults or inherited UI state.
export const createTab = (
  path: string,
  base?: Pick<Tab, "viewMode" | "sidebarOpen" | "sort">,
  defaults: Pick<Tab, "viewMode" | "sidebarOpen" | "sort"> = DEFAULT_TAB_STATE,
): Tab => {
  const sortState: SortState = base?.sort ?? defaults.sort;
  return {
    id: `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    path,
    viewMode: base?.viewMode ?? defaults.viewMode,
    sidebarOpen: base?.sidebarOpen ?? defaults.sidebarOpen,
    sort: { ...sortState },
  };
};
