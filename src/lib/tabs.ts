// Tab creation helpers with default view settings.
import type { SortState, Tab, ViewMode } from "@/types";
import { DEFAULT_SORT } from "./sort";

export const DEFAULT_TAB_STATE = {
  viewMode: "thumbs" as ViewMode,
  sort: { ...DEFAULT_SORT },
  // Per-tab search so filters stick with their owning tab.
  search: "",
  scrollTop: 0,
};

// Creates a new tab with defaults or inherited UI state.
export const createTab = (
  path: string,
  base?: Partial<Pick<Tab, "viewMode" | "sort" | "search">>,
  defaults: Pick<Tab, "viewMode" | "sort" | "search"> = DEFAULT_TAB_STATE,
): Tab => {
  const sortState: SortState = base?.sort ?? defaults.sort;
  const search = base?.search ?? defaults.search ?? "";
  return {
    id: `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    path,
    // New tabs start with their current path as the crumb trail.
    crumbTrailPath: path,
    viewMode: base?.viewMode ?? defaults.viewMode,
    // New tabs always start at the top of their view.
    scrollTop: 0,
    sort: { ...sortState },
    search,
  };
};
