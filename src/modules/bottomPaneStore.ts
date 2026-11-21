// Layout preferences are separate from the two folder tab sessions.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createTab } from "@/lib/tabs";
import type { ViewMode } from "@/types";
import { useBottomSessionStore, useSessionStore } from "./sessionStore";

export const clampPaneHeight = (percent: number) => Math.min(70, Math.max(22, percent));

type BottomPaneState = {
  open: boolean;
  height: number;
  defaultViewMode: ViewMode;
  active: boolean;
  navigation: { path: string; newTab: boolean } | null;
};

export type BottomPaneLayout = Omit<BottomPaneState, "navigation">;

export const DEFAULT_BOTTOM_PANE_LAYOUT: BottomPaneLayout = {
  open: false,
  height: 35,
  defaultViewMode: "list",
  active: false,
};

export const useBottomPaneStore = create<BottomPaneState>()(persist(
  (): BottomPaneState => ({ ...DEFAULT_BOTTOM_PANE_LAYOUT, navigation: null }),
  { name: "stratum.bottom-pane", partialize: ({ open, height, defaultViewMode }) => ({ open, height, defaultViewMode }) },
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
    const tab = createTab(initial, { viewMode: preferences.defaultViewMode });
    bottom.updateSession({ tabs: [tab], activeTabId: tab.id });
    // A mounted pane needs an explicit navigation for its new tab.
    if (!preferences.open) path = undefined;
    newTab = false;
  }
  useBottomPaneStore.setState({ open: true, active: true, navigation: path ? { path, newTab } : null });
};
