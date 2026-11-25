import type { ViewMode } from "./view";
import type { SortState } from "./sort";
import type { FixedGridSize } from "@/modules/settings.types";

export type TerminalSession = { key: string; directory: string };
export type TerminalSplit = {
  terminal: TerminalSession;
  folderPercent: number;
  linkDirectory?: boolean;
  terminalFirst?: boolean;
  stacked?: boolean;
};

export type Tab = {
  id: string;
  path: string;
  terminal?: TerminalSession;
  split?: TerminalSplit;
  // Deepest path visited in this tab's current branch for breadcrumb continuation.
  crumbTrailPath: string;
  viewMode: ViewMode;
  gridSize?: FixedGridSize;
  gridAutoColumns?: number;
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
  navigation?: {
    path: string;
    sort?: SortState;
    search?: string;
    revealPath?: string;
    resetFilter?: boolean;
  };
};
