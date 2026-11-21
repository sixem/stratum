// Builds the rename action for entry menus.

import type { ContextMenuItem, EntryContextTarget } from "@/types";

type BuildEntryRenameItemsOptions = {
  target: EntryContextTarget;
  hasTargets: boolean;
  multiple: boolean;
  onRenameEntry: (target: EntryContextTarget) => void;
};

export const buildEntryRenameItems = ({
  target,
  hasTargets,
  multiple,
  onRenameEntry,
}: BuildEntryRenameItemsOptions): ContextMenuItem[] => [
  {
    id: "entry-rename",
    label: multiple ? "Batch rename…" : "Rename",
    icon: "rename",
    onSelect: () => {
      if (!hasTargets) return;
      onRenameEntry(target);
    },
    disabled: !hasTargets,
  },
];
