import { showBottomPane } from "@/modules/bottomPaneStore";
import { isPreviewableEntry } from "@/lib";
// Builds the basic open actions for an entry menu.

import type { ContextMenuItem, EntryContextTarget } from "@/types";

type BuildEntryOpenItemsOptions = {
  target: EntryContextTarget;
  hasTargets: boolean;
  onOpenEntry: (path: string) => void;
  onOpenGallery: (path: string) => void;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab: (path: string) => void;
  onOpenDirInMainPane?: (path: string) => void;
};

export const buildEntryOpenItems = ({
  target,
  hasTargets,
  onOpenEntry,
  onOpenGallery,
  onOpenDir,
  onOpenDirNewTab,
  onOpenDirInMainPane,
}: BuildEntryOpenItemsOptions): ContextMenuItem[] => {
  const items: ContextMenuItem[] = [
    {
      id: "entry-open",
      label: "Open",
      icon: "open",
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

  if (hasTargets && isPreviewableEntry(target)) {
    items.push({
      id: "entry-open-gallery",
      label: "Open in gallery",
      icon: "open-gallery",
      onSelect: () => onOpenGallery(target.path),
    });
  }

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
    items.push({
      id: "entry-open-other-pane",
      label: onOpenDirInMainPane ? "Open in main pane" : "Open in bottom pane",
      onSelect: () => {
        if (onOpenDirInMainPane) onOpenDirInMainPane(target.path);
        else showBottomPane(target.path);
      },
    });
  }
  return items;
};
