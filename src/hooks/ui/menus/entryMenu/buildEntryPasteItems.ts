// Builds the paste action for entry menus.

import type { ContextMenuItem, EntryContextTarget } from "@/types";

type BuildEntryPasteItemsOptions = {
  target: EntryContextTarget;
  canPaste: boolean;
  pasteTarget: string;
  onPasteEntries: (destination: string) => Promise<unknown> | void;
};

export const buildEntryPasteItems = ({
  target,
  canPaste,
  pasteTarget,
  onPasteEntries,
}: BuildEntryPasteItemsOptions): ContextMenuItem[] => {
  if (!target.isDir && !canPaste) return [];

  return [
    {
      id: "entry-paste",
      label: target.isDir ? "Paste into folder" : "Paste",
      icon: target.isDir ? "paste-into-folder" : "paste",
      onSelect: () => {
        if (pasteTarget) void onPasteEntries(pasteTarget);
      },
      disabled: !canPaste,
    },
  ];
};
