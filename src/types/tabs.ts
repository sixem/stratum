import type { ViewMode } from "./view";
import type { SortState } from "./sort";
import type { FixedGridSize } from "@/modules/settings.types";

export type Tab = {
  id: string;
  path: string;
  // Deepest path visited in this tab's current branch for breadcrumb continuation.
  crumbTrailPath: string;
  viewMode: ViewMode;
  gridSize?: FixedGridSize;
  scrollTop: number;
  sort: SortState;
  search: string;
};

export type TabHistory = {
  back: string[];
  forward: string[];
};

export type TabHistoryDirection = keyof TabHistory;

export type TabTransfer = {
  tab: Tab;
  history?: TabHistory;
};
