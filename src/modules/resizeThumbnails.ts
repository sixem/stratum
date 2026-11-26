// Apply relative thumbnail sizing with the same rules for keys and the wheel.
import type { useSessionStore } from "./sessionStore";
import { useSettingsStore } from "./settings.store";
import { clampAutoColumns, FIXED_GRID_SIZES } from "./tabGridSize";

export function resizeThumbnails(steps: number, store: typeof useSessionStore, tabId?: string | null) {
  const session = store.getState();
  // A wheel event from an outgoing grid must not resize the incoming tab.
  if (tabId !== undefined && session.activeTabId !== tabId) return false;
  const activeTab = session.tabs.find(item => item.id === session.activeTabId);
  if (!activeTab || activeTab.terminal || activeTab.viewMode !== "thumbs") return false;

  const { gridSize, gridAutoColumns, rememberTabGridSize, updateSettings } = useSettingsStore.getState();
  const tab = rememberTabGridSize ? activeTab : undefined;

  if (gridSize === "auto") {
    // Fewer columns make the cards larger while preserving the auto layout.
    const current = tab?.gridAutoColumns ?? gridAutoColumns;
    const columns = clampAutoColumns(current - steps);
    if (columns !== current) {
      if (tab) session.setTabGridSize(tab.id, columns);
      else updateSettings({ gridAutoColumns: columns });
    }
  } else {
    const index = FIXED_GRID_SIZES.indexOf(tab?.gridSize ?? gridSize);
    const nextIndex = Math.min(FIXED_GRID_SIZES.length - 1, Math.max(0, index + steps));
    if (nextIndex !== index) {
      const size = FIXED_GRID_SIZES[nextIndex];
      if (tab) session.setTabGridSize(tab.id, size);
      else updateSettings({ gridSize: size });
    }
  }
  return true;
}
