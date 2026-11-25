// Reveal the incoming tab after its content and scroll layout have committed.
import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ViewMode } from "@/types";

type TabRevealOptions = {
  tabId: string | null;
  ready: boolean;
  enabled: boolean;
  view: ViewMode | "lander";
  viewKey: string;
};

const REVEAL_KEYFRAMES = [
  { opacity: 0.7, transform: "translateY(3px)" },
  { opacity: 1, transform: "translateY(0)" },
];

export const useTabReveal = (
  paneRef: RefObject<HTMLElement | null>,
  { tabId, ready, enabled, view, viewKey }: TabRevealOptions,
) => {
  const previousTab = useRef(tabId);
  const pending = useRef(false);

  // A changed view key also stops an in-flight reveal during same-tab navigation.
  useLayoutEffect(() => {
    if (previousTab.current !== tabId) {
      pending.current = enabled && previousTab.current !== null && tabId !== null;
      previousTab.current = tabId;
    }
    if (!enabled) pending.current = false;

    const pane = paneRef.current;
    if (!pending.current || !ready || !pane) return;
    let animation: Animation | undefined;
    let observer: MutationObserver | undefined;
    const reveal = () => {
      const content = pane.querySelector<HTMLElement>(`:scope > [data-tab-content="${view}"]`);
      if (!content || content.style.display === "none") return false;
      observer?.disconnect();
      pending.current = false;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
      animation = content.animate(REVEAL_KEYFRAMES, {
        duration: 170,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "backwards",
      });
      return true;
    };

    // A lazily loaded list or grid can still be under Suspense once its folder is ready.
    if (!reveal()) {
      observer = new MutationObserver(reveal);
      observer.observe(pane, { childList: true });
    }
    return () => {
      observer?.disconnect();
      animation?.cancel();
    };
  }, [enabled, paneRef, ready, tabId, view, viewKey]);
};
