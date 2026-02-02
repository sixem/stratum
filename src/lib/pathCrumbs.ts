// Shared breadcrumb helpers used by the crumb bar and trail navigation.
import { normalizePath } from "./paths";

export type PathCrumb = {
  label: string;
  path: string;
  key: string;
};

export type PathCrumbsState = {
  crumbs: PathCrumb[];
  activeIndex: number;
};

export const buildPathCrumbs = (path: string): PathCrumb[] => {
  const trimmed = path.trim();
  if (!trimmed) return [];

  const normalized = trimmed.replace(/\//g, "\\");
  const endsWithSlash = /\\$/.test(normalized);
  const isDrivePath = /^[a-zA-Z]:/.test(normalized);
  const isUncPath = normalized.startsWith("\\\\");
  const segments = normalized.split("\\").filter(Boolean);
  if (segments.length === 0) return [];

  const crumbs: PathCrumb[] = [];
  let current = "";
  let startIndex = 0;

  if (isDrivePath) {
    const drive = segments[0];
    const hasMore = segments.length > 1;
    current = hasMore || endsWithSlash ? `${drive}\\` : drive;
    crumbs.push({ label: drive, path: current, key: current });
    startIndex = 1;
  } else if (isUncPath) {
    const server = segments[0];
    const share = segments[1];
    if (server && share) {
      const hasMore = segments.length > 2;
      current = `\\\\${server}\\${share}${hasMore || endsWithSlash ? "\\" : ""}`;
      crumbs.push({ label: `${server}\\${share}`, path: current, key: current });
      startIndex = 2;
    } else if (server) {
      current = `\\\\${server}${endsWithSlash ? "\\" : ""}`;
      crumbs.push({ label: current, path: current, key: current });
      startIndex = 1;
    }
  }

  for (let index = startIndex; index < segments.length; index += 1) {
    if (current && !current.endsWith("\\")) {
      current += "\\";
    }
    current += segments[index];
    crumbs.push({ label: segments[index], path: current, key: current });
  }

  return crumbs;
};

// Prefer the stored trail path when it still contains the current path.
export const resolvePathCrumbs = (
  path: string,
  trailPath?: string | null,
): PathCrumbsState => {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return { crumbs: buildPathCrumbs(path), activeIndex: -1 };
  }
  const trimmedTrail = trailPath?.trim();
  const displayPath = trimmedTrail ? trimmedTrail : path;
  const trailCrumbs = buildPathCrumbs(displayPath);
  const currentKey = normalizePath(trimmedPath);
  const currentIndex = trailCrumbs.findIndex(
    (crumb) => normalizePath(crumb.path) === currentKey,
  );
  if (currentIndex !== -1) {
    return { crumbs: trailCrumbs, activeIndex: currentIndex };
  }
  const currentCrumbs = buildPathCrumbs(path);
  return { crumbs: currentCrumbs, activeIndex: currentCrumbs.length - 1 };
};

export const getNextTrailPath = (
  path: string,
  trailPath?: string | null,
): string | null => {
  const { crumbs, activeIndex } = resolvePathCrumbs(path, trailPath);
  if (activeIndex < 0) return null;
  const next = crumbs[activeIndex + 1];
  return next?.path ?? null;
};
