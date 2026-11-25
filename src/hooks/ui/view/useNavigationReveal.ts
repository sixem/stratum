// Select and position the entry a navigation is meant to reveal.
import { useLayoutEffect, useRef } from "react";
import type { ScrollAlignment } from "@/hooks/perf/scroll";
import { folderPathKey } from "@/lib/paths";
import type { FileViewModel } from "./useFileViewModel";

type NavigationRevealOptions = {
  path: string | null;
  viewKey: string;
  loading: boolean;
  viewModel: FileViewModel;
  setSelection: (paths: string[], anchor?: string) => void;
  scrollToIndex: (index: number, alignment?: ScrollAlignment) => void;
};

export const useNavigationReveal = ({
  path, viewKey, loading, viewModel, setSelection, scrollToIndex,
}: NavigationRevealOptions) => {
  const revealed = useRef<{ path: string; viewKey: string } | null>(null);
  useLayoutEffect(() => {
    if (!path) {
      revealed.current = null;
      return;
    }
    if (loading || (revealed.current?.path === path && revealed.current.viewKey === viewKey)) return;

    const key = folderPathKey(path);
    const exactEntry = viewModel.entryByPath.get(path);
    const matchingItem = exactEntry ? undefined : viewModel.items.find(
      (item) => item.type === "entry" && folderPathKey(item.entry.path) === key,
    );
    const entry = exactEntry ?? (matchingItem?.type === "entry" ? matchingItem.entry : undefined);
    if (!entry) return;
    const index = viewModel.indexMap.get(entry.path);
    if (index == null) return;

    revealed.current = { path, viewKey };
    setSelection([entry.path], entry.path);
    scrollToIndex(index, "center");
  }, [loading, path, scrollToIndex, setSelection, viewKey, viewModel]);
};
