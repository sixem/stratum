// Builds the paste action for entry menus.

import type { ContextMenuItem, EntryContextTarget } from "@/types";

type BuildEntryPasteItemsOptions = {
  target: EntryContextTarget;
  canPaste: boolean;
  clipboardPaths: string[];
  pasteTarget: string;
  onPasteEntries: (paths: string[], destination: string) => Promise<unknown> | void;
};

export const buildEntryPasteItems = ({
  target,
  canPaste,
  clipboardPaths,
  pasteTarget,
  onPasteEntries,
}: BuildEntryPasteItemsOptions): ContextMenuItem[] => {
  if (!target.isDir && !canPaste) return [];

  return [
    {
      id: "entry-paste",
      label: target.isDir ? "Paste into folder" : "Paste",
      onSelect: () => {
        if (clipboardPaths.length === 0) return;
        if (!pasteTarget) return;
        void onPasteEntries(clipboardPaths, pasteTarget);
      },
      disabled: !canPaste,
    },
  ];
};
