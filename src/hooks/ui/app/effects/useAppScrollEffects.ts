// Scroll persistence and restore invalidation effects for tab/view changes.
import { useEffect } from "react";
import type { AppEffectActions, AppEffectRefs } from "./appEffectTypes";

type UseAppScrollEffectsOptions = Pick<AppEffectRefs, "lastViewRef"> &
  Pick<AppEffectActions, "setTabScrollTop" | "stashActiveScroll"> & {
    activeTabId: string | null;
    viewPathKey: string;
    shouldResetScroll: boolean;
  };

export const useAppScrollEffects = ({
  lastViewRef,
  activeTabId,
  viewPathKey,
  shouldResetScroll,
  setTabScrollTop,
  stashActiveScroll,
}: UseAppScrollEffectsOptions) => {
  useEffect(() => {
    if (!shouldResetScroll || !activeTabId) return;
    // Reset the stored scroll position when a tab navigates to a new path.
    setTabScrollTop(activeTabId, 0);
  }, [activeTabId, setTabScrollTop, shouldResetScroll]);

  useEffect(() => {
    // Remember the last tab/path so we can detect in-tab navigation.
    lastViewRef.current = { tabId: activeTabId, pathKey: viewPathKey };
  }, [activeTabId, lastViewRef, viewPathKey]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      stashActiveScroll();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [stashActiveScroll]);
};
