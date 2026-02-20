// Shared menu builder for folder-like targets that can be saved as places.
import { normalizePath } from "@/lib";
import type { ContextMenuItem, PlaceContextTarget, Place } from "@/types";

type BuildPlaceTargetMenuItemsOptions = {
  target: PlaceContextTarget | null;
  places: Place[];
  onAddPlace: (path: string, name?: string, options?: { pinned?: boolean }) => void;
  onPinPlace: (path: string) => void;
  onUnpinPlace: (path: string) => void;
  onRemovePlace: (path: string) => void;
  onRemoveRecentJump?: (path: string) => void;
  onOpenProperties?: (path: string) => void | Promise<unknown>;
};

const placeKey = (path: string) => normalizePath(path.trim()) ?? path.trim().toLowerCase();

const buildPlacesMap = (places: Place[]) => {
  const map = new Map<string, Place>();
  places.forEach((place) => {
    const key = placeKey(place.path);
    if (!key || map.has(key)) return;
    map.set(key, place);
  });
  return map;
};

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
  onAddPlace,
  onPinPlace,
  onUnpinPlace,
  onRemovePlace,
  onRemoveRecentJump,
  onOpenProperties,
}: BuildPlaceTargetMenuItemsOptions): ContextMenuItem[] => {
  if (!target) return [];
  const path = target.path.trim();
  if (!path) return [];
  const key = placeKey(path);
  const map = buildPlacesMap(places);
  const existing = map.get(key) ?? null;
  const isPinned = existing?.pinned === true;

  const addOrUpdate = (options?: { pinned?: boolean }) => {
    onAddPlace(path, target.name, options);
  };

  const items: ContextMenuItem[] = [];

  if (existing) {
    items.push({
      id: "place-target-pin-toggle",
      label: buildPinLabel(target.source, true, isPinned),
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
      onSelect: () => onRemovePlace(path),
    });
  } else {
    items.push({
      id: "place-target-add",
      label: buildAddLabel(target.source),
      onSelect: () => addOrUpdate(),
    });
    items.push({
      id: "place-target-pin",
      label: buildPinLabel(target.source, false, false),
      onSelect: () => addOrUpdate({ pinned: true }),
    });
  }

  if (target.source === "sidebar-recent" && onRemoveRecentJump) {
    items.push({ kind: "divider", id: "place-target-divider-recent" });
    items.push({
      id: "place-target-remove-recent",
      label: "Remove from recent jumps",
      onSelect: () => onRemoveRecentJump(path),
    });
  }

  if (onOpenProperties) {
    items.push({ kind: "divider", id: "place-target-divider-properties" });
    items.push({
      id: "place-target-properties",
      label: "Properties",
      onSelect: () => {
        void onOpenProperties(path);
      },
    });
  }

  return items;
};
