import type { ViewMode } from "./view";
import type { SortState } from "./sort";
import type { FixedGridSize } from "@/modules/settings.types";

// Identifies a terminal view and its starting directory. The live process stays in the terminal component.
export type TerminalSession = { key: string; directory: string };
export type TerminalSplit = {
  terminal: TerminalSession;
  folderPercent: number;
  linkDirectory?: boolean;
  terminalFirst?: boolean;
  stacked?: boolean;
};

type TabBase = {
  id: string;
  path: string;
  anchored?: true;
  // Deepest path visited in this tab's current branch for breadcrumb continuation.
  crumbTrailPath: string;
  viewMode: ViewMode;
  gridSize?: FixedGridSize;
  gridAutoColumns?: number;
  scrollTop: number;
  sort: SortState;
  search: string;
};

export type FolderTab = TabBase & { kind: "folder"; split?: TerminalSplit; terminal?: never };
export type TerminalTab = TabBase & { kind: "terminal"; terminal: TerminalSession; split?: never };
export type Tab = FolderTab | TerminalTab;

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
