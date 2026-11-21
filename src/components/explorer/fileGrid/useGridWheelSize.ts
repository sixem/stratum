// Handle Ctrl+wheel over the thumbnail grid using the existing sizing settings.
import { useEffect } from "react";
import type { RefObject } from "react";
import { GRID_AUTO_COLUMNS_MAX, GRID_AUTO_COLUMNS_MIN } from "@/constants";
import { useSettingsStore } from "@/modules";
import type { useSessionStore } from "@/modules/sessionStore";
import { FIXED_GRID_SIZES, getDefaultTabGridSize } from "@/modules/tabGridSize";

const WHEEL_GESTURE_GAP_MS = 200;

const resizeGrid = (steps: number, store: typeof useSessionStore, tabId: string | null) => {
  const settings = useSettingsStore.getState();
  const { gridSize, gridAutoColumns, updateSettings } = settings;
  if (gridSize === "auto") {
    // Fewer columns make the cards larger while preserving the auto layout.
    const columns = Math.min(GRID_AUTO_COLUMNS_MAX, Math.max(GRID_AUTO_COLUMNS_MIN, gridAutoColumns - steps));
    if (columns !== gridAutoColumns) updateSettings({ gridAutoColumns: columns });
    return;
  }

  const tabDefault = getDefaultTabGridSize(settings);
  const session = store.getState();
  const tab = tabDefault && session.activeTabId === tabId ? session.tabs.find(item => item.id === tabId) : undefined;
  // A wheel event from an outgoing grid must not resize the incoming tab.
  if (tabDefault && !tab) return;

  const index = FIXED_GRID_SIZES.indexOf(tab?.gridSize ?? gridSize);
  const nextIndex = Math.min(FIXED_GRID_SIZES.length - 1, Math.max(0, index + steps));
  if (nextIndex === index) return;
  const size = FIXED_GRID_SIZES[nextIndex];
  if (tab) session.setTabGridSize(tab.id, size);
  else updateSettings({ gridSize: size });
};

export const useGridWheelSize = (
  viewportRef: RefObject<HTMLDivElement | null>,
  viewKey: string,
  store: typeof useSessionStore,
  tabId: string | null,
) => {
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let lastWheelAt = -Infinity;
    let pendingSteps = 0;
    const handleWheel = (event: WheelEvent) => {
      if (
        !event.ctrlKey || event.shiftKey || event.altKey || event.metaKey ||
        event.buttons !== 0 || event.defaultPrevented || !event.cancelable
      ) return;

      const { deltaMode, deltaX, deltaY } = event;
      if (Math.abs(deltaY) <= Math.abs(deltaX)) return;
      // Claim the gesture even at a size limit so the WebView does not zoom.
      event.preventDefault();

      const unitsPerStep = deltaMode === WheelEvent.DOM_DELTA_LINE ? 3
        : deltaMode === WheelEvent.DOM_DELTA_PAGE ? 1
        : 100;
      const deltaSteps = -deltaY / unitsPerStep;
      const startsGesture = event.timeStamp - lastWheelAt > WHEEL_GESTURE_GAP_MS;
      if (startsGesture || pendingSteps * deltaSteps < 0) pendingSteps = 0;
      lastWheelAt = event.timeStamp;
      pendingSteps += deltaSteps;

      // Respond to the first tick, then group small deltas from a continuous gesture.
      const steps = Math.trunc(pendingSteps);
      if (steps !== 0) {
        pendingSteps -= steps;
        resizeGrid(steps, store, tabId);
      } else if (startsGesture) {
        pendingSteps = 0;
        resizeGrid(Math.sign(deltaSteps), store, tabId);
      }
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [store, tabId, viewKey, viewportRef]);
};
