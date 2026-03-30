// User-managed places store (seeded from defaults once, then fully editable).
import { createWithEqualityFn } from "zustand/traditional";
import { PLACES_STORAGE_KEY, PLACES_STORAGE_VERSION } from "@/constants";
import { normalizePath, tabLabel } from "@/lib";
import type { Place } from "@/types";

type StoredPlacesState = {
  version: number;
  initialized: boolean;
  places: Place[];
};

type PlacesStore = {
  initialized: boolean;
  places: Place[];
  seedDefaults: (defaults: Place[]) => void;
  addPlace: (path: string, name?: string, options?: { pinned?: boolean }) => void;
  pinPlace: (path: string) => void;
  unpinPlace: (path: string) => void;
  reorderPinnedPlace: (fromPath: string, toPath: string, position: "before" | "after") => void;
  removePlace: (path: string) => void;
};

const STORAGE_KEY = PLACES_STORAGE_KEY;
const STORAGE_VERSION = PLACES_STORAGE_VERSION;

const DEFAULT_STATE: Omit<
  PlacesStore,
  "seedDefaults" | "addPlace" | "pinPlace" | "unpinPlace" | "reorderPinnedPlace" | "removePlace"
> = {
  initialized: false,
  places: [],
};

const toPlaceKey = (path: string): string | null => {
  const trimmed = path.trim();
  if (!trimmed) return null;
  return normalizePath(trimmed) ?? trimmed.toLowerCase();
};

const coercePlaceName = (value: unknown, fallbackPath: string) => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const fallback = tabLabel(fallbackPath);
  return fallback || fallbackPath;
};

const coercePlaceEntry = (value: unknown): Place | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as { name?: unknown; path?: unknown; pinned?: unknown };
  if (typeof raw.path !== "string") return null;
  const path = raw.path.trim();
  if (!path) return null;
  return {
    name: coercePlaceName(raw.name, path),
    path,
    pinned: raw.pinned === true,
  };
};

const orderPlaces = (places: Place[]) => {
  const pinned = places.filter((place) => place.pinned);
  const normal = places.filter((place) => !place.pinned);
  return [...pinned, ...normal];
};

const dedupePlaces = (places: Place[]) => {
  const next: Place[] = [];
  const seen = new Set<string>();
  places.forEach((place) => {
    const key = toPlaceKey(place.path);
    if (!key || seen.has(key)) return;
    seen.add(key);
    next.push({
      name: coercePlaceName(place.name, place.path),
      path: place.path.trim(),
      pinned: place.pinned === true,
    });
  });
  return orderPlaces(next);
};

const placeNameFromPath = (path: string) => {
  const label = tabLabel(path);
  return label || path;
};

const insertPlace = (places: Place[], place: Place) => {
  if (place.pinned) {
    const firstUnpinned = places.findIndex((item) => !item.pinned);
    if (firstUnpinned === -1) {
      places.push(place);
      return places;
    }
    places.splice(firstUnpinned, 0, place);
    return places;
  }
  places.push(place);
  return places;
};

const reorderPinnedPlaces = (
  places: Place[],
  fromPath: string,
  toPath: string,
  position: "before" | "after",
) => {
  const fromKey = toPlaceKey(fromPath);
  const toKey = toPlaceKey(toPath);
  if (!fromKey || !toKey || fromKey === toKey) return places;

  const pinned = places.filter((place) => place.pinned === true);
  const normal = places.filter((place) => place.pinned !== true);
  const fromIndex = pinned.findIndex((place) => toPlaceKey(place.path) === fromKey);
  const toIndex = pinned.findIndex((place) => toPlaceKey(place.path) === toKey);
  if (fromIndex < 0 || toIndex < 0) return places;

  const nextPinned = [...pinned];
  const [moved] = nextPinned.splice(fromIndex, 1);
  if (!moved) return places;

  const targetIndex = nextPinned.findIndex((place) => toPlaceKey(place.path) === toKey);
  if (targetIndex < 0) return places;

  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  nextPinned.splice(insertIndex, 0, moved);
  return [...nextPinned, ...normal];
};

const updatePlace = (
  places: Place[],
  path: string,
  patch: Partial<Pick<Place, "name" | "pinned">>,
) => {
  const key = toPlaceKey(path);
  if (!key) return places;
  const index = places.findIndex((item) => toPlaceKey(item.path) === key);
  if (index === -1) return places;
  const current = places[index];
  const nextPlace: Place = {
    name: coercePlaceName(patch.name ?? current.name, current.path),
    path: current.path,
    pinned: patch.pinned ?? current.pinned ?? false,
  };
  const next = [...places];
  next.splice(index, 1);
  return insertPlace(next, nextPlace);
};

const readStoredPlaces = (): StoredPlacesState => {
  try {
    if (!("localStorage" in globalThis)) {
      return { version: STORAGE_VERSION, ...DEFAULT_STATE };
    }
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: STORAGE_VERSION, ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as
      | StoredPlacesState
      | { initialized?: unknown; places?: unknown }
      | unknown;
    if (!parsed || typeof parsed !== "object") {
      return { version: STORAGE_VERSION, ...DEFAULT_STATE };
    }
    const withState = parsed as { version?: unknown; initialized?: unknown; places?: unknown };
    const list = Array.isArray(withState.places)
      ? withState.places
          .map((item) => coercePlaceEntry(item))
          .filter((item): item is Place => Boolean(item))
      : [];
    return {
      version:
        typeof withState.version === "number" ? withState.version : STORAGE_VERSION,
      initialized: withState.initialized === true || list.length > 0,
      places: dedupePlaces(list),
    };
  } catch {
    return { version: STORAGE_VERSION, ...DEFAULT_STATE };
  }
};

const writeStoredPlaces = (state: Pick<PlacesStore, "initialized" | "places">) => {
  try {
    if (!("localStorage" in globalThis)) return;
    const payload: StoredPlacesState = {
      version: STORAGE_VERSION,
      initialized: state.initialized,
      places: state.places,
    };
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage write failures (private mode, denied, etc.).
  }
};

const initialState = readStoredPlaces();

export const usePlacesStore = createWithEqualityFn<PlacesStore>((set) => ({
  initialized: initialState.initialized,
  places: initialState.places,
  seedDefaults: (defaults) =>
    set((state) => {
      if (state.initialized) return state;
      const seeded = dedupePlaces(
        defaults.map((place) => ({
          name: coercePlaceName(place.name, place.path),
          path: place.path.trim(),
          pinned: place.pinned === true,
        })),
      );
      return {
        initialized: true,
        places: seeded,
      };
    }),
  addPlace: (path, name, options) =>
    set((state) => {
      const trimmedPath = path.trim();
      const key = toPlaceKey(trimmedPath);
      if (!key) return state;
      const existingIndex = state.places.findIndex((item) => toPlaceKey(item.path) === key);
      const nextName = coercePlaceName(name, trimmedPath);
      const shouldPin = options?.pinned === true;
      if (existingIndex >= 0) {
        const existing = state.places[existingIndex];
        const next = updatePlace(state.places, trimmedPath, {
          name: nextName || existing.name,
          pinned: shouldPin ? true : existing.pinned === true,
        });
        return {
          initialized: true,
          places: next,
        };
      }
      const nextPlace: Place = {
        name: nextName || placeNameFromPath(trimmedPath),
        path: trimmedPath,
        pinned: shouldPin,
      };
      return {
        initialized: true,
        places: insertPlace([...state.places], nextPlace),
      };
    }),
  pinPlace: (path) =>
    set((state) => ({
      initialized: true,
      places: updatePlace(state.places, path, { pinned: true }),
    })),
  unpinPlace: (path) =>
    set((state) => ({
      initialized: true,
      places: updatePlace(state.places, path, { pinned: false }),
    })),
  reorderPinnedPlace: (fromPath, toPath, position) =>
    set((state) => ({
      initialized: true,
      places: reorderPinnedPlaces(state.places, fromPath, toPath, position),
    })),
  removePlace: (path) =>
    set((state) => {
      const key = toPlaceKey(path);
      if (!key) return state;
      return {
        initialized: true,
        places: state.places.filter((item) => toPlaceKey(item.path) !== key),
      };
    }),
}));

usePlacesStore.subscribe((state) => {
  writeStoredPlaces({
    initialized: state.initialized,
    places: state.places,
  });
});
