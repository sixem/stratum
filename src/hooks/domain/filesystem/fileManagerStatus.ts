// Select the most relevant local activity for the footer.
import type { IndexedSearchServiceState } from "@/types/indexedSearch";
import type { StatusState } from "./fileManager.types";

export function fileManagerStatus({ loadingPath, fileActivity, placesLoaded, indexState, indexActivity }: {
  loadingPath: string | null; fileActivity: string | null; placesLoaded: boolean;
  indexState?: IndexedSearchServiceState; indexActivity?: string | null;
}): StatusState {
  if (loadingPath) return { level: "loading", message: `Loading ${loadingPath}` };
  if (fileActivity) return { level: "loading", message: fileActivity };
  if (!placesLoaded) return { level: "loading", message: "Loading locations" };
  if (indexState === "error") return { level: "error", message: "Indexed search unavailable" };
  if (indexState === "starting") return { level: "loading", message: "Checking saved indexes" };
  if (indexState === "scanning") return { level: "loading", message: indexActivity?.trim() || "Updating index" };
  return { level: "idle", message: "Ready" };
}
