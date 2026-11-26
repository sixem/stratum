// Run tab wheel shortcuts in the hovered pane and group trackpad deltas.
import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { createWheelStepper } from "@/hooks/perf/scroll/wheelSteps";
import { buildKeybindFromWheel, getTabShortcutDirection, isWheelKeybind } from "@/modules/keybinds";
import { useSettingsStore } from "@/modules/settings.store";

const MIN_TAB_STEP_INTERVAL_MS = 80;

export function useTabWheelShortcuts(
  paneRef: RefObject<HTMLDivElement | null>,
  onStep: (direction: -1 | 1) => void,
  canNavigate: () => boolean,
) {
  const hasWheelBinding = useSettingsStore(({ keybinds }) =>
    isWheelKeybind(keybinds.prevTab) || isWheelKeybind(keybinds.nextTab));
  const handlers = useRef({ onStep, canNavigate });
  useLayoutEffect(() => { handlers.current = { onStep, canNavigate }; }, [onStep, canNavigate]);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || !hasWheelBinding) return;

    const step = createWheelStepper();
    let lastTabStep = -Infinity;
    let lastDirection: -1 | 1 | null = null;
    const handleWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || !event.cancelable) return;
      const binding = buildKeybindFromWheel(event);
      if (!binding) return;
      const { keybinds, terminalTabNavigation } = useSettingsStore.getState();
      const direction = getTabShortcutDirection(binding, keybinds);
      if (direction === null || !handlers.current.canNavigate()) return;
      if (!terminalTabNavigation && event.target instanceof Element && event.target.closest("[data-terminal]")) return;

      event.preventDefault();
      event.stopPropagation();
      if (!step(event, binding)) return;
      if (lastDirection === direction && event.timeStamp - lastTabStep < MIN_TAB_STEP_INTERVAL_MS) return;
      lastTabStep = event.timeStamp;
      lastDirection = direction;
      handlers.current.onStep(direction);
    };

    pane.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => pane.removeEventListener("wheel", handleWheel, true);
  }, [hasWheelBinding, paneRef]);
}
