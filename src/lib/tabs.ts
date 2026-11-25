// Tab creation helpers with default view settings.
import type { SortState, Tab, ViewMode } from "@/types";
import type { FolderTab } from "@/types/tabs";
import { DEFAULT_SORT } from "./sort";

export const DEFAULT_TAB_STATE = {
  viewMode: "thumbs" as ViewMode,
  sort: { ...DEFAULT_SORT },
  // Per-tab search so filters stick with their owning tab.
  search: "",
  scrollTop: 0,
};

// Both panes use the same end-of-strip behavior for previous and next shortcuts.
export const getAdjacentTab = (tabs: readonly Tab[], activeId: string | null, direction: -1 | 1, wrap: boolean) => {
  const index = tabs.findIndex((tab) => tab.id === activeId);
  if (activeId === null) return direction === 1 ? tabs[0] : tabs[tabs.length - 1];
  if (index < 0 || tabs.length < 2) return undefined;
  const next = index + direction;
  return tabs[wrap ? (next + tabs.length) % tabs.length : next];
};

// Creates a new tab with defaults or inherited UI state.
export const createTab = (
  path: string,
  base?: Partial<Pick<Tab, "viewMode" | "sort" | "search">>,
  defaults: Pick<Tab, "viewMode" | "sort" | "search"> = DEFAULT_TAB_STATE,
): FolderTab => {
  const sortState: SortState = base?.sort ?? defaults.sort;
  const search = base?.search ?? defaults.search ?? "";
  return {
    id: `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: "folder",
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
