// Resize thumbnails when a configured wheel shortcut targets the grid.
import { useEffect } from "react";
import type { RefObject } from "react";
import { createWheelStepper } from "@/hooks/perf/scroll/wheelSteps";
import { buildKeybindFromWheel, isWheelKeybind } from "@/modules/keybinds";
import { resizeThumbnails } from "@/modules/resizeThumbnails";
import type { useSessionStore } from "@/modules/sessionStore";
import { useSettingsStore } from "@/modules/settings.store";

export const useGridWheelSize = (
  viewportRef: RefObject<HTMLDivElement | null>,
  viewKey: string,
  store: typeof useSessionStore,
  tabId: string | null,
) => {
  const hasWheelBinding = useSettingsStore(({ keybinds }) =>
    isWheelKeybind(keybinds.increaseThumbnailSize) || isWheelKeybind(keybinds.decreaseThumbnailSize));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !hasWheelBinding) return;

    const step = createWheelStepper();
    const handleWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || !event.cancelable) return;
      const binding = buildKeybindFromWheel(event);
      if (!binding) return;
      const { keybinds } = useSettingsStore.getState();
      if (binding !== keybinds.increaseThumbnailSize && binding !== keybinds.decreaseThumbnailSize) return;
      // Claim the gesture even at a size limit so the WebView does not zoom.
      event.preventDefault();
      const steps = step(event, binding);
      if (steps) resizeThumbnails(binding === keybinds.increaseThumbnailSize ? steps : -steps, store, tabId);
    };

    // Give assigned shortcuts priority over grid scroll snapping.
    viewport.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel, true);
  }, [hasWheelBinding, store, tabId, viewKey, viewportRef]);
};
