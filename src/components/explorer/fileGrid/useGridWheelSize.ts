// Handle Ctrl+wheel over the thumbnail grid using the existing sizing settings.
import { useEffect } from "react";
import type { RefObject } from "react";
import { GRID_AUTO_COLUMNS_MAX, GRID_AUTO_COLUMNS_MIN } from "@/constants";
import { useSettingsStore } from "@/modules";

const FIXED_SIZES = ["small", "normal", "large"] as const;
const WHEEL_GESTURE_GAP_MS = 200;

const resizeGrid = (steps: number) => {
  const { gridSize, gridAutoColumns, updateSettings } = useSettingsStore.getState();
  if (gridSize === "auto") {
    // Fewer columns make the cards larger while preserving the auto layout.
    const columns = Math.min(GRID_AUTO_COLUMNS_MAX, Math.max(GRID_AUTO_COLUMNS_MIN, gridAutoColumns - steps));
    if (columns !== gridAutoColumns) updateSettings({ gridAutoColumns: columns });
    return;
  }

  const index = FIXED_SIZES.indexOf(gridSize);
  const nextIndex = Math.min(FIXED_SIZES.length - 1, Math.max(0, index + steps));
  if (nextIndex !== index) updateSettings({ gridSize: FIXED_SIZES[nextIndex] });
};

export const useGridWheelSize = (viewportRef: RefObject<HTMLDivElement | null>, viewKey: string) => {
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
        resizeGrid(steps);
      } else if (startsGesture) {
        pendingSteps = 0;
        resizeGrid(Math.sign(deltaSteps));
      }
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [viewKey, viewportRef]);
};
