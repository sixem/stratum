import type { ViewMode } from "./view";
import type { SortState } from "./sort";

export type Tab = {
  id: string;
  path: string;
  // Deepest path visited in this tab's current branch for breadcrumb continuation.
  crumbTrailPath: string;
  viewMode: ViewMode;
  scrollTop: number;
  sort: SortState;
  search: string;
};
