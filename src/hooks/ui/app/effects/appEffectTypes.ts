import type { RefObject } from "react";
import type { AccentTheme } from "@/modules";
import type { EntryContextTarget, SortState, Tab, ViewMode } from "@/types";

// Shared effect contracts for the app-shell side-effect composers.
// Keeping these in one file makes the focused effect hooks easier to scan.

export type AppEffectRefs = {
  searchInputRef: RefObject<HTMLInputElement | null>;
  lastViewRef: RefObject<{ tabId: string | null; pathKey: string } | null>;
};

export type AppEffectSettings = {
  confirmClose: boolean;
  accentTheme: AccentTheme;
  ambientBackground: boolean;
  blurOverlays: boolean;
  gridRounded: boolean;
  gridCentered: boolean;
};

export type AppEffectView = {
  activeTabId: string | null;
  activeTabPath: string;
  activeSearch: string;
  searchValue: string;
  currentPath: string;
  viewPath: string;
  viewPathKey: string;
  viewMode: ViewMode;
  loading: boolean;
  sidebarOpen: boolean;
  deferredSearchValue: string;
  sortState: SortState;
  tabs: Tab[];
  contextMenuOpen: boolean;
};

export type AppEffectActions = {
  clearSearchAndFocusView: () => void;
  closePreviewIfOpen: () => boolean;
  setSearchValue: (value: string) => void;
  setTabSearch: (value: string) => void;
  flushWindowSize: () => void;
  loadDir: (
    path: string,
    options?: { sort?: SortState; search?: string; silent?: boolean },
  ) => Promise<void>;
  requestEntryMeta: (
    paths: string[],
    options?: { force?: boolean; defer?: boolean },
  ) => Promise<unknown>;
  clearDir: (options?: { silent?: boolean }) => void;
  setRenameTarget: (value: EntryContextTarget | null) => void;
  setRenameValue: (value: string) => void;
  setTabScrollTop: (tabId: string, top: number) => void;
  stashActiveScroll: () => void;
  onPresenceToggle: (suppress: boolean) => void;
};

export type UseAppEffectsOptions = {
  isTauriEnv: boolean;
  appName: string;
  appVersion: string;
  refs: AppEffectRefs;
  settings: AppEffectSettings;
  view: AppEffectView;
  actions: AppEffectActions;
  shouldResetScroll: boolean;
  viewLog: (...args: unknown[]) => void;
};
