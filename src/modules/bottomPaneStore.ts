// Layout preferences are separate from the two folder tab sessions.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewMode } from "@/types";
import { createSessionTab, useBottomSessionStore, useSessionStore } from "./sessionStore";

export const PANE_DIVIDER_HEIGHT = 4;
export const MIN_MAIN_PANE_HEIGHT = 120;
export const MIN_BOTTOM_PANE_HEIGHT = 120;

type PaneHeight = { height: number; heightUnit: "px" | "%" };

type BottomPaneState = PaneHeight & {
  open: boolean;
  defaultViewMode: ViewMode;
  showBreadcrumbs: boolean;
  active: boolean;
  navigation: { path: string; newTab: boolean } | null;
};

export type BottomPaneLayout = Omit<BottomPaneState, "navigation" | "defaultViewMode" | "showBreadcrumbs">;

export const DEFAULT_BOTTOM_PANE_LAYOUT: BottomPaneLayout = {
  open: false,
  height: 240,
  heightUnit: "px",
  active: false,
};

export const coerceBottomPaneHeight = (value?: Partial<PaneHeight>): PaneHeight => {
  const height = value?.height;
  if (typeof height !== "number" || !Number.isFinite(height)) {
    return { height: DEFAULT_BOTTOM_PANE_LAYOUT.height, heightUnit: "px" };
  }
  if (value?.heightUnit === "px") {
    return { height: Math.max(MIN_BOTTOM_PANE_HEIGHT, Math.round(height)), heightUnit: "px" };
  }
  // Older sessions and workspaces stored a percentage. Resolve it on first display.
  return { height: Math.min(70, Math.max(22, height)), heightUnit: "%" };
};

export const useBottomPaneStore = create<BottomPaneState>()(persist(
  (): BottomPaneState => ({
    ...DEFAULT_BOTTOM_PANE_LAYOUT, defaultViewMode: "list", showBreadcrumbs: false, navigation: null,
  }),
  {
    name: "stratum.bottom-pane",
    partialize: ({ open, height, heightUnit, defaultViewMode, showBreadcrumbs }) => ({
      open, height, heightUnit, defaultViewMode, showBreadcrumbs,
    }),
    merge: (stored, current) => {
      const value = stored as Partial<Omit<BottomPaneState, "active" | "navigation">> | undefined;
      return { ...current, ...value, ...coerceBottomPaneHeight(value), showBreadcrumbs: value?.showBreadcrumbs === true };
    },
  },
));

export const setBottomPaneActive = (active: boolean) => {
  const current = useBottomPaneStore.getState();
  if (current.open && current.active !== active) useBottomPaneStore.setState({ active });
};

export const hideBottomPane = () => useBottomPaneStore.setState({ open: false, active: false, navigation: null });

export const showBottomPane = (path?: string, newTab = true) => {
  const bottom = useBottomSessionStore.getState();
  const preferences = useBottomPaneStore.getState();
  if (!bottom.tabs.length) {
    const main = useSessionStore.getState();
    const initial = path ?? main.tabs.find(tab => tab.id === main.activeTabId)?.path ?? "";
    const tab = createSessionTab(initial, { viewMode: preferences.defaultViewMode });
    bottom.updateSession({ tabs: [tab], activeTabId: tab.id });
    // A mounted pane needs an explicit navigation for its new tab.
    if (!preferences.open) path = undefined;
    newTab = false;
  }
  useBottomPaneStore.setState({ open: true, active: true, navigation: path ? { path, newTab } : null });
};
