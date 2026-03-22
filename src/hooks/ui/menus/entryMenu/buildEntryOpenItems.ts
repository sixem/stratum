// Builds the basic open actions for an entry menu.

import type { ContextMenuItem, EntryContextTarget } from "@/types";

type BuildEntryOpenItemsOptions = {
  target: EntryContextTarget;
  hasTargets: boolean;
  onOpenEntry: (path: string) => void;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab: (path: string) => void;
};

export const buildEntryOpenItems = ({
  target,
  hasTargets,
  onOpenEntry,
  onOpenDir,
  onOpenDirNewTab,
}: BuildEntryOpenItemsOptions): ContextMenuItem[] => {
  const items: ContextMenuItem[] = [
    {
      id: "entry-open",
      label: "Open",
      onSelect: () => {
        if (!hasTargets) return;
        if (target.isDir) {
          onOpenDir(target.path);
          return;
        }
        onOpenEntry(target.path);
      },
      disabled: !hasTargets,
    },
  ];

  if (target.isDir) {
    items.push({
      id: "entry-open-new-tab",
      label: "Open in new tab",
      onSelect: () => {
        if (!hasTargets) return;
        onOpenDirNewTab(target.path);
      },
      disabled: !hasTargets,
    });
  }

  return items;
};
