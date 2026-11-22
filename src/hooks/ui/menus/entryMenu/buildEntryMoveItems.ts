// Offer recent folders for the current selection, using the same path rules
// as drag-and-drop to identify no-op moves and overlapping folders.
import { getParentPath, getPathName, joinPath, normalizeDropPath } from "@/lib";
import type { ContextMenuItem } from "@/types";

type Options = {
  destinations: readonly string[];
  actionTargets: string[];
  onMoveEntries: (paths: string[], destination: string) => void;
  onClear: () => void;
};

export const buildEntryMoveItems = ({
  destinations, actionTargets, onMoveEntries, onClear,
}: Options): ContextMenuItem[] => {
  if (!destinations.length || !actionTargets.length) return [];
  const sources = actionTargets.map((path) => ({
    name: getPathName(path),
    key: normalizeDropPath(path),
    parentKey: normalizeDropPath(getParentPath(path) ?? ""),
  }));

  const items = destinations.map((destination): ContextMenuItem => {
    const key = normalizeDropPath(destination);
    const disabled = !key || sources.every((source) => source.parentKey === key) || sources.some((source) => {
      const outputKey = normalizeDropPath(joinPath(destination, source.name));
      return key === source.key || key.startsWith(source.key + "\\") ||
        source.key.startsWith(outputKey + "\\");
    });
    return {
      id: `entry-move-${destination}`,
      label: destination,
      wrapLabel: true,
      icon: "open-folder",
      disabled,
      onSelect: () => onMoveEntries(actionTargets, destination),
    };
  });

  return [{
    kind: "submenu",
    id: "entry-move-to",
    label: "Move to",
    icon: "paste-into-folder",
    items: [
      ...items,
      { kind: "divider", id: "entry-move-divider" },
      { id: "entry-clear-recent-moves", label: "Clear recent destinations", icon: "remove", onSelect: onClear },
    ],
  }];
};
