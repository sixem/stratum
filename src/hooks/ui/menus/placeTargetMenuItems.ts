// Shared menu builder for folder-like targets that can be saved as places.
import { folderPathKey, getParentPath, getPathName, normalizePath } from "@/lib";
import { writeFileClipboard, writeTextClipboard } from "@/modules/clipboardStore";
import { usePlacesStore } from "@/modules/placesStore";
import type { ContextMenuItem, PlaceContextTarget, Place } from "@/types";
import { showEntryRenamePrompt } from "./showEntryRenamePrompt";

type BuildPlaceTargetMenuItemsOptions = {
  target: PlaceContextTarget | null;
  places: Place[];
  tabActions: ContextMenuItem[];
  onOpenPath?: (path: string) => void;
  onOpenPathNewTab?: (path: string) => void;
  onOpenPathInBackgroundTab?: (path: string) => void;
  otherPane?: { label: string; open: (path: string) => void };
  onSelectTab?: (id: string) => void;
  onRenameFolder: (path: string, name: string) => Promise<unknown>;
  onPasteIntoFolder?: (path: string) => void;
  canPaste: boolean;
  onAddPlace: (path: string, name?: string, options?: { pinned?: boolean }) => void;
  onPinPlace: (path: string) => void;
  onUnpinPlace: (path: string) => void;
  onRemovePlace: (path: string) => void;
  onRemoveRecentJump?: (path: string) => void;
  onOpenProperties?: (path: string) => void | Promise<unknown>;
};

export const isSidebarPlaceTarget = (target: PlaceContextTarget | null) =>
  target?.source === "sidebar-place" || target?.source === "sidebar-recent";

const buildAddLabel = (source: PlaceContextTarget["source"]) => {
  if (source === "sidebar-recent") return "Add to places";
  return "Add folder to places";
};

const buildPinLabel = (source: PlaceContextTarget["source"], exists: boolean, pinned: boolean) => {
  if (exists && pinned) return "Unpin from places";
  if (source === "sidebar-recent") return "Pin to places";
  return exists ? "Pin to top" : "Pin to places";
};

export const buildPlaceTargetMenuItems = ({
  target,
  places,
  tabActions,
  onOpenPath,
  onOpenPathNewTab,
  onOpenPathInBackgroundTab,
  otherPane,
  onSelectTab,
  onRenameFolder,
  onPasteIntoFolder,
  canPaste,
  onAddPlace,
  onPinPlace,
  onUnpinPlace,
  onRemovePlace,
  onRemoveRecentJump,
  onOpenProperties,
}: BuildPlaceTargetMenuItemsOptions): ContextMenuItem[] => {
  if (!target) return [];
  const path = target.path.trim();
  const items = [...tabActions];
  if (!path) return items;
  if (items.length) items.push({ kind: "divider", id: "place-target-divider-tab" });
  const key = normalizePath(path);
  const existing = places.find((place) => normalizePath(place.path) === key);
  const isPinned = existing?.pinned === true;
  const hasFolderActions = isSidebarPlaceTarget(target) || target.source === "tab";
  const parent = hasFolderActions ? getParentPath(path) : null;
  const hasParent = parent && folderPathKey(parent) !== folderPathKey(path);
  const folderName = getPathName(path);

  const addOrUpdate = (options?: { pinned?: boolean }) => {
    onAddPlace(path, target.name, options);
  };

  const { tabId } = target;
  const open = tabId && onSelectTab ? () => onSelectTab(tabId) :
    onOpenPath ? () => onOpenPath(path) : undefined;
  const navigationStart = items.length;

  if (open) {
    items.push({
      id: "place-target-open",
      label: "Open",
      icon: "open-folder",
      onSelect: open,
    });
  }

  if (onOpenPathNewTab) {
    items.push({
      id: "place-target-open-new-tab",
      label: "Open in new tab",
      icon: "open-new-tab",
      onSelect: () => onOpenPathNewTab(path),
    });
  }

  if (onOpenPathInBackgroundTab) {
    items.push({
      id: "place-target-open-background-tab",
      label: "Open in background tab",
      icon: "open-new-tab",
      onSelect: () => onOpenPathInBackgroundTab(path),
    });
  }

  if (hasFolderActions && otherPane) {
    items.push({
      id: "place-target-open-other-pane",
      label: otherPane.label,
      icon: "open-folder",
      onSelect: () => otherPane.open(path),
    });
  }

  if (hasParent && onOpenPath) {
    items.push({
      id: "place-target-open-parent",
      label: "Open parent folder",
      icon: "open-folder",
      onSelect: () => onOpenPath(parent),
    });
  }

  if (items.length > navigationStart) {
    items.push({ kind: "divider", id: "place-target-divider-open" });
  }

  if (hasFolderActions) {
    items.push(
      {
        id: "place-target-copy",
        label: "Copy",
        icon: "copy",
        onSelect: () => { void writeFileClipboard([path], "copy"); },
      },
      {
        id: "place-target-copy-path",
        label: "Copy path",
        icon: "copy",
        onSelect: () => { void writeTextClipboard(path); },
      },
    );
    if (onPasteIntoFolder) {
      items.push({
        id: "place-target-paste",
        label: "Paste into folder",
        icon: "paste-into-folder",
        disabled: !canPaste,
        onSelect: () => onPasteIntoFolder(path),
      });
    }
    if (hasParent && folderName) {
      items.push({
        id: "place-target-rename-folder",
        label: "Rename folder…",
        icon: "rename",
        onSelect: () => showEntryRenamePrompt({ path, name: folderName }, onRenameFolder, "Rename folder"),
      });
    }
    items.push({ kind: "divider", id: "place-target-divider-folder" });
  }

  if (target.source === "sidebar-place" && existing) {
    items.push({
      id: "place-target-rename-place",
      label: "Rename place…",
      icon: "rename",
      onSelect: () => showEntryRenamePrompt({ path, name: existing.name },
        usePlacesStore.getState().renamePlace, "Rename place"),
    });
  }

  if (existing) {
    items.push({
      id: "place-target-pin-toggle",
      label: buildPinLabel(target.source, true, isPinned),
      icon: isPinned ? "unpin" : "pin",
      onSelect: () => {
        if (isPinned) {
          onUnpinPlace(path);
        } else {
          onPinPlace(path);
        }
      },
    });
    items.push({
      id: "place-target-remove",
      label: "Remove from places",
      icon: "remove",
      onSelect: () => onRemovePlace(path),
    });
  } else {
    items.push({
      id: "place-target-add",
      label: buildAddLabel(target.source),
      icon: "add",
      onSelect: () => addOrUpdate(),
    });
    items.push({
      id: "place-target-pin",
      label: buildPinLabel(target.source, false, false),
      icon: "pin",
      onSelect: () => addOrUpdate({ pinned: true }),
    });
  }

  if (target.source === "sidebar-recent" && onRemoveRecentJump) {
    items.push({ kind: "divider", id: "place-target-divider-recent" });
    items.push({
      id: "place-target-remove-recent",
      label: "Remove from recent jumps",
      icon: "remove",
      onSelect: () => onRemoveRecentJump(path),
    });
  }

  if (onOpenProperties) {
    items.push({ kind: "divider", id: "place-target-divider-properties" });
    items.push({
      id: "place-target-properties",
      label: "Properties",
      icon: "properties",
      onSelect: () => {
        void onOpenProperties(path);
      },
    });
  }

  return items;
};
