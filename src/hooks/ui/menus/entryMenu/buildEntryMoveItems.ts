// Offer recent folders for the current selection, using the same path rules
// as drag-and-drop to identify no-op moves and overlapping folders.
import { getPathName } from "@/lib";
import { createMoveDestinationGuard } from "@/lib/moveDestination";
import type { ContextMenuItem } from "@/types";

type Options = {
  destinations: readonly string[];
  actionTargets: string[];
  onMoveEntries: (paths: string[], destination: string) => void;
  onQuickMove?: (paths: string[]) => void;
  onClear: () => void;
};

export const buildEntryMoveItems = ({
  destinations, actionTargets, onMoveEntries, onQuickMove, onClear,
}: Options): ContextMenuItem[] => {
  if ((!destinations.length && !onQuickMove) || !actionTargets.length) return [];
  const isDestinationDisabled = createMoveDestinationGuard(actionTargets);

  const items: ContextMenuItem[] = [];
  if (onQuickMove) {
    items.push({
      id: "entry-quick-move",
      label: "Search folders…",
      icon: "open-folder",
      onSelect: () => onQuickMove(actionTargets),
    });
    if (destinations.length) items.push({ kind: "divider", id: "entry-quick-move-divider" });
  }
  if (destinations.length) {
    items.push(...destinations.map((destination): ContextMenuItem => ({
      id: `entry-move-${destination}`,
      label: getPathName(destination) || destination,
      tooltip: destination,
      icon: "open-folder",
      disabled: isDestinationDisabled(destination),
      onSelect: () => onMoveEntries(actionTargets, destination),
    })),
    { kind: "divider", id: "entry-move-divider" },
    { id: "entry-clear-recent-moves", label: "Clear recent", icon: "remove", onSelect: onClear });
  }

  return [{
    kind: "submenu",
    id: "entry-move-to",
    label: "Move to",
    wide: true,
    icon: "paste-into-folder",
    items,
  }];
};
