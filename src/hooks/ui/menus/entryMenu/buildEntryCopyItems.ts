// Builds the copy action for entry menus.

import type { ContextMenuItem } from "@/types";

type BuildEntryCopyItemsOptions = {
  actionTargets: string[];
  hasTargets: boolean;
  onCopyEntries: (paths: string[]) => void;
};

export const buildEntryCopyItems = ({
  actionTargets,
  hasTargets,
  onCopyEntries,
}: BuildEntryCopyItemsOptions): ContextMenuItem[] => [
  {
    id: "entry-copy",
    label: "Copy",
    icon: "copy",
    onSelect: () => {
      if (!hasTargets) return;
      onCopyEntries(actionTargets);
    },
    disabled: !hasTargets,
  },
];
