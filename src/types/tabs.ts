import type { ViewMode } from "./view";
import type { SortState } from "./sort";

export type Tab = {
  id: string;
  path: string;
  viewMode: ViewMode;
  sidebarOpen: boolean;
  sort: SortState;
};
