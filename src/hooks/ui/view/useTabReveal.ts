// Reveal the incoming tab after its content and scroll layout have committed.
import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ViewMode } from "@/types";

type TabRevealOptions = {
  tabId: string | null;
  ready: boolean;
  enabled: boolean;
  view: ViewMode | "lander";
  pathKey: string;
};

const REVEAL_KEYFRAMES = [
  { opacity: 0.45, transform: "translateY(8px) scale(0.993)" },
  { opacity: 1, transform: "translateY(0) scale(1)" },
];

export const useTabReveal = (
  paneRef: RefObject<HTMLElement | null>,
  { tabId, ready, enabled, view, pathKey }: TabRevealOptions,
) => {
  const previous = useRef({ tabId, pathKey });
  const pending = useRef(false);

  useLayoutEffect(() => {
    const before = previous.current;
    if (before.tabId !== tabId) {
      pending.current = enabled && before.tabId !== null && tabId !== null && before.pathKey !== pathKey;
    } else if (before.pathKey !== pathKey) {
      // A navigation within the selected tab supersedes any pending tab reveal.
      pending.current = false;
    }
    previous.current = { tabId, pathKey };
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
        duration: 230,
        easing: "cubic-bezier(0.22, 0.75, 0.21, 1)",
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
  }, [enabled, paneRef, pathKey, ready, tabId, view]);
};
