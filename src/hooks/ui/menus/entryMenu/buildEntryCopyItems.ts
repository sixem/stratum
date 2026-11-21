// Clipboard actions use the same Windows formats as the corresponding shortcuts.

import type { ContextMenuItem } from "@/types";
import { writeFileClipboard } from "@/modules";

type BuildEntryCopyItemsOptions = {
  actionTargets: string[];
  hasTargets: boolean;
  showShortcuts: boolean;
};

export const buildEntryCopyItems = ({
  actionTargets,
  hasTargets,
  showShortcuts,
}: BuildEntryCopyItemsOptions): ContextMenuItem[] => [
  {
    id: "entry-cut",
    label: "Cut",
    icon: "cut",
    hint: showShortcuts ? "Ctrl+X" : undefined,
    onSelect: () => { void writeFileClipboard(actionTargets, "move"); },
    disabled: !hasTargets,
  },
  {
    id: "entry-copy",
    label: "Copy",
    icon: "copy",
    hint: showShortcuts ? "Ctrl+C" : undefined,
    onSelect: () => { void writeFileClipboard(actionTargets, "copy"); },
    disabled: !hasTargets,
  },
];
