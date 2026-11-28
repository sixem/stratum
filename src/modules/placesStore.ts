// User-managed places store (seeded from defaults once, then fully editable).
import { createWithEqualityFn } from "zustand/traditional";
import { PLACES_STORAGE_KEY, PLACES_STORAGE_VERSION } from "@/constants";
import { placeKey, placeName, type PlaceReference } from "@/lib/placeLocation";
import { isRemoteLocation } from "@/lib/tabRestore";
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
  addPlace: (path: PlaceReference, name?: string, options?: { pinned?: boolean }) => void;
  renamePlace: (path: PlaceReference, name: string) => void;
  pinPlace: (path: PlaceReference) => void;
  unpinPlace: (path: PlaceReference) => void;
  setPinColor: (path: PlaceReference, color?: string) => void;
  reorderPinnedPlace: (fromPath: PlaceReference, toPath: PlaceReference, position: "before" | "after") => void;
  removePlace: (path: PlaceReference) => void;
};

export type PlacesState = Pick<PlacesStore, "initialized" | "places">;

const STORAGE_KEY = PLACES_STORAGE_KEY;
const STORAGE_VERSION = PLACES_STORAGE_VERSION;

export const DEFAULT_PLACES_STATE: PlacesState = {
  initialized: false,
  places: [],
};

const coercePlaceEntry = (value: unknown): Place | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as { hostId?: unknown; name?: unknown; path?: unknown; pinned?: unknown; pinColor?: unknown };
  if (typeof raw.path !== "string") return null;
  if (raw.hostId !== undefined && !isRemoteLocation(value)) return null;
  const hostId = typeof raw.hostId === "string" ? raw.hostId : undefined;
  const path = hostId ? raw.path : raw.path.trim();
  if (!path) return null;
  return {
    ...(hostId ? { hostId } : {}),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : placeName({ hostId, path }),
    path,
    pinned: raw.pinned === true,
    pinColor: typeof raw.pinColor === "string" && /^#[0-9a-f]{6}$/i.test(raw.pinColor) ? raw.pinColor : undefined,
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
    const key = placeKey(place);
    if (!key || seen.has(key)) return;
    seen.add(key);
    next.push(place);
  });
  return orderPlaces(next);
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
  fromPath: PlaceReference,
  toPath: PlaceReference,
  position: "before" | "after",
) => {
  const fromKey = placeKey(fromPath);
  const toKey = placeKey(toPath);
  if (!fromKey || !toKey || fromKey === toKey) return places;

  const pinned = places.filter((place) => place.pinned === true);
  const normal = places.filter((place) => place.pinned !== true);
  const fromIndex = pinned.findIndex((place) => placeKey(place) === fromKey);
  const toIndex = pinned.findIndex((place) => placeKey(place) === toKey);
  if (fromIndex < 0 || toIndex < 0) return places;

  const nextPinned = [...pinned];
  const [moved] = nextPinned.splice(fromIndex, 1);
  if (!moved) return places;

  const targetIndex = nextPinned.findIndex((place) => placeKey(place) === toKey);
  if (targetIndex < 0) return places;

  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  nextPinned.splice(insertIndex, 0, moved);
  return [...nextPinned, ...normal];
};

const updatePlace = (
  places: Place[],
  path: PlaceReference,
  patch: Partial<Pick<Place, "name" | "pinned">>,
) => {
  const key = placeKey(path);
  if (!key) return places;
  const index = places.findIndex((item) => placeKey(item) === key);
  if (index === -1) return places;
  const current = places[index];
  const nextPlace: Place = { ...current, ...patch };
  const next = [...places];
  next.splice(index, 1);
  return insertPlace(next, nextPlace);
};

export const coercePlacesState = (value: { initialized?: unknown; places?: unknown }): PlacesState => {
  const list = Array.isArray(value.places)
    ? value.places.map(coercePlaceEntry).filter((item): item is Place => Boolean(item))
    : [];
  return { initialized: value.initialized === true || list.length > 0, places: dedupePlaces(list) };
};

const readStoredPlaces = (): PlacesState => {
  try {
    if (!("localStorage" in globalThis)) {
      return DEFAULT_PLACES_STATE;
    }
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLACES_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_PLACES_STATE;
    }
    return coercePlacesState(parsed as { initialized?: unknown; places?: unknown });
  } catch {
    return DEFAULT_PLACES_STATE;
  }
};

export const serializePlaces = ({ initialized, places }: PlacesState) => {
  const payload: StoredPlacesState = { version: STORAGE_VERSION, initialized, places };
  return [STORAGE_KEY, JSON.stringify(payload)] as const;
};

const writeStoredPlaces = (state: PlacesState) => {
  try {
    if (!("localStorage" in globalThis)) return;
    globalThis.localStorage.setItem(...serializePlaces(state));
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
      const seeded = coercePlacesState({ places: defaults }).places;
      return {
        initialized: true,
        places: seeded,
      };
    }),
  addPlace: (path, name, options) =>
    set((state) => {
      const location = typeof path === "string" ? { path } : path;
      const candidate = coercePlaceEntry({ ...location, name, pinned: options?.pinned });
      if (!candidate) return state;
      const key = placeKey(candidate);
      const existing = state.places.find(item => placeKey(item) === key);
      if (existing) {
        return { initialized: true, places: updatePlace(state.places, existing, {
          name: name?.trim() || existing.name,
          pinned: options?.pinned || existing.pinned,
        }) };
      }
      return {
        initialized: true,
        places: insertPlace([...state.places], candidate),
      };
    }),
  renamePlace: (path, name) =>
    set((state) => {
      const key = placeKey(path);
      const nextName = name.trim();
      const index = key ? state.places.findIndex((place) => placeKey(place) === key) : -1;
      if (!nextName || index < 0 || state.places[index].name === nextName) return state;
      // Editing the display name preserves the place's position.
      const places = state.places.slice();
      places[index] = { ...places[index], name: nextName };
      return { places };
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
  setPinColor: (path, color) =>
    set((state) => ({ places: state.places.map((place) =>
      placeKey(place) === placeKey(path) ? { ...place, pinColor: color } : place) })),
  reorderPinnedPlace: (fromPath, toPath, position) =>
    set((state) => ({
      initialized: true,
      places: reorderPinnedPlaces(state.places, fromPath, toPath, position),
    })),
  removePlace: (path) =>
    set((state) => {
      const key = placeKey(path);
      if (!key) return state;
      return {
        initialized: true,
        places: state.places.filter((item) => placeKey(item) !== key),
      };
    }),
}));

usePlacesStore.subscribe((state) => {
  writeStoredPlaces({
    initialized: state.initialized,
    places: state.places,
  });
});
