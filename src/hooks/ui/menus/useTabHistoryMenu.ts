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
  openActionMenu: ReturnType<typeof useAppMenuState>["openActionMenu"],
) => useCallback((event: MouseEvent<HTMLButtonElement>, direction: TabHistoryDirection) => {
  const paths = getActiveHistoryPaths(direction);
  const items = paths.map<ContextMenuItem>((path, offset) => {
    const label = path.startsWith("/") ? path.split("/").filter(Boolean).pop() || "/" : tabLabel(path);
    return {
      id: `history-${offset}`,
      label,
      tooltip: path === label ? undefined : path,
      icon: "open-folder",
      onSelect: () => navigateHistory(direction, offset, path),
    };
  });
  openActionMenu(event, items, true);
}, [getActiveHistoryPaths, navigateHistory, openActionMenu]);
