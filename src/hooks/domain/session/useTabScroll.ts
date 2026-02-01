// Scroll position helpers for per-tab storage.
import { useCallback } from "react";
import type { Tab } from "@/types";

type SetTabs = (next: Tab[] | ((prev: Tab[]) => Tab[])) => void;

type UseTabScrollOptions = {
  setTabs: SetTabs;
};

export const useTabScroll = ({ setTabs }: UseTabScrollOptions) => {
  const setTabScrollTop = useCallback(
    (id: string, scrollTop: number) => {
      if (!id) return;
      const nextTop = Math.max(0, Math.round(scrollTop));
      // Skip updates when the stored scroll offset has not changed.
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === id && tab.scrollTop !== nextTop ? { ...tab, scrollTop: nextTop } : tab,
        ),
      );
    },
    [setTabs],
  );

  return { setTabScrollTop };
};
