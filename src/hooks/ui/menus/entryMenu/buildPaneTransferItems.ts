// Use the same destination guard as Quick Move for explicit pane transfers.
import { createMoveDestinationGuard } from "@/lib/moveDestination";
import { getPathName } from "@/lib/paths";
import type { ContextMenuItem } from "@/types";

export type PaneTransfer = {
  destination: string;
  run: (mode: "copy" | "move", paths: string[]) => void;
};

export const canTransferToPane = (paths: string[], destination: string) =>
  paths.length > 0 && !createMoveDestinationGuard(paths)(destination);

export function buildPaneTransferItems(paths: string[], { destination, run }: PaneTransfer): ContextMenuItem[] {
  if (!canTransferToPane(paths, destination)) return [];
  const name = getPathName(destination) || destination;
  return [
    {
      id: "entry-copy-to-other-pane",
      label: `Copy to ${name}`,
      tooltip: destination,
      icon: "copy",
      onSelect: () => run("copy", paths),
    },
    {
      id: "entry-move-to-other-pane",
      label: `Move to ${name}`,
      tooltip: destination,
      icon: "paste-into-folder",
      onSelect: () => run("move", paths),
    },
  ];
}
