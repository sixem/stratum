// Builds the rename action for entry menus.

import type { ContextMenuItem, EntryContextTarget } from "@/types";

type BuildEntryRenameItemsOptions = {
  target: EntryContextTarget;
  hasTargets: boolean;
  onRenameEntry: (target: EntryContextTarget) => void;
};

export const buildEntryRenameItems = ({
  target,
  hasTargets,
  onRenameEntry,
}: BuildEntryRenameItemsOptions): ContextMenuItem[] => [
  {
    id: "entry-rename",
    label: "Rename",
    onSelect: () => {
      if (!hasTargets) return;
      onRenameEntry(target);
    },
    disabled: !hasTargets,
  },
];
