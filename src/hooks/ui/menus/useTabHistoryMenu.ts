// Convert one direction of the active tab's history into the shared context menu.
import { useCallback } from "react";
import type { MouseEvent } from "react";
import type { useTabSession } from "@/hooks/domain/session/useTabSession";
import type { ContextMenuItem } from "@/types";
import type { TabHistoryDirection } from "@/types/tabs";
import { tabLabel } from "@/lib";
import type { useAppMenuState } from "../app/useAppMenuState";

export const useTabHistoryMenu = (
  { getActiveHistoryPaths, navigateHistory }: Pick<
    ReturnType<typeof useTabSession>, "getActiveHistoryPaths" | "navigateHistory"
  >,
  openContextMenuAt: ReturnType<typeof useAppMenuState>["openContextMenuAt"],
) => useCallback((event: MouseEvent<HTMLButtonElement>, direction: TabHistoryDirection) => {
  event.preventDefault();
  event.stopPropagation();
  const paths = getActiveHistoryPaths(direction);
  if (paths.length === 0) return;
  const items = paths.map<ContextMenuItem>((path, offset) => {
    const label = tabLabel(path);
    return {
      id: `history-${offset}`,
      label,
      tooltip: path === label ? undefined : path,
      icon: "open-folder",
      onSelect: () => navigateHistory(direction, offset, path),
    };
  });
  // A keyboard-invoked context menu can arrive without cursor coordinates.
  const anchor = event.currentTarget.getBoundingClientRect();
  const hasPoint = event.clientX !== 0 || event.clientY !== 0;
  openContextMenuAt({
    kind: "history",
    x: hasPoint ? event.clientX : anchor.left,
    y: hasPoint ? event.clientY : anchor.bottom,
    items,
  });
}, [getActiveHistoryPaths, navigateHistory, openContextMenuAt]);
