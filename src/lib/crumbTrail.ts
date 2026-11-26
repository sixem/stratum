import { folderPathKey } from "./paths.ts";

// Keep a deeper trail while visiting its ancestors. A sibling starts a new trail.
export function resolveCrumbTrailPath(current: string, previous: string, remote = false) {
  const path = remote ? current : current.trim();
  const trail = remote ? previous : previous.trim();
  if (!path || !trail) return path;
  const separator = remote ? "/" : "\\";
  const key = remote ? path : folderPathKey(path);
  const trailKey = remote ? trail : folderPathKey(trail);
  if (!key || !trailKey || key === trailKey) return path;
  return trailKey.startsWith(key.endsWith(separator) ? key : key + separator) ? trail : path;
}
