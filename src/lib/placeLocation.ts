// Local places follow Windows path equality. Remote paths are exact within a saved host.
import { normalizePath, tabLabel } from "./paths";
import type { Place } from "@/types/fs";

export type PlaceLocation = Pick<Place, "path" | "hostId">;
export type PlaceReference = string | PlaceLocation;

export function placeKey(ref: PlaceReference) {
  if (typeof ref !== "string" && ref.hostId) return JSON.stringify([ref.hostId, ref.path]);
  const path = (typeof ref === "string" ? ref : ref.path).trim();
  return path ? JSON.stringify([normalizePath(path)]) : null;
}

export function placeName(location: PlaceLocation) {
  return location.hostId ? location.path.split("/").filter(Boolean).pop() ?? "/" : tabLabel(location.path) || location.path;
}
