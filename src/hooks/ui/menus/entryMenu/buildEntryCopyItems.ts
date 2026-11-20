// Clipboard actions use the same Windows formats as the corresponding shortcuts.

import type { ContextMenuItem } from "@/types";
import { writeFileClipboard } from "@/modules";

type BuildEntryCopyItemsOptions = {
  actionTargets: string[];
  hasTargets: boolean;
};

export const buildEntryCopyItems = ({
  actionTargets,
  hasTargets,
}: BuildEntryCopyItemsOptions): ContextMenuItem[] => [
  {
    id: "entry-cut",
    label: "Cut",
    icon: "cut",
    hint: "Ctrl+X",
    onSelect: () => { void writeFileClipboard(actionTargets, "move"); },
    disabled: !hasTargets,
  },
  {
    id: "entry-copy",
    label: "Copy",
    icon: "copy",
    hint: "Ctrl+C",
    onSelect: () => { void writeFileClipboard(actionTargets, "copy"); },
    disabled: !hasTargets,
  },
];
