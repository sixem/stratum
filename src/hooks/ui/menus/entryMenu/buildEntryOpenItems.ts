// Builds the basic open actions for an entry menu.

import type { ContextMenuItem, EntryContextTarget } from "@/types";

type BuildEntryOpenItemsOptions = {
  target: EntryContextTarget;
  targetCount: number;
  onOpenEntry: (path: string) => void;
  onOpenGallery?: (path: string) => void;
  galleryPath?: string;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab?: (path: string) => void;
  otherPane?: { label: string; open: (path: string) => void };
};

export const buildEntryOpenItems = ({
  target,
  targetCount,
  onOpenEntry,
  onOpenGallery,
  galleryPath,
  onOpenDir,
  onOpenDirNewTab,
  otherPane,
}: BuildEntryOpenItemsOptions): ContextMenuItem[] => {
  const hasTargets = targetCount > 0;
  const items: ContextMenuItem[] = [
    {
      id: "entry-open",
      label: "Open",
      icon: target.isDir ? "open-folder" : "open",
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

  if (hasTargets && onOpenGallery && galleryPath) {
    items.push({
      id: "entry-open-gallery",
      label: targetCount > 1 ? "Open selected in gallery" : "Open in gallery",
      icon: "open-gallery",
      onSelect: () => onOpenGallery(galleryPath),
    });
  }

  if (target.isDir && onOpenDirNewTab) {
    items.push({
      id: "entry-open-new-tab",
      label: "Open in new tab",
      icon: "open-new-tab",
      onSelect: () => {
        if (!hasTargets) return;
        onOpenDirNewTab(target.path);
      },
      disabled: !hasTargets,
    });
  }
  if (target.isDir && otherPane) {
    items.push({
      id: "entry-open-other-pane",
      label: otherPane.label,
      icon: "open-folder",
      onSelect: () => otherPane.open(target.path),
    });
  }
  return items;
};
