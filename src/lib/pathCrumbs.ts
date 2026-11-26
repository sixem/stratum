// Shared breadcrumb helpers used by the crumb bar and trail navigation.
import { remoteCrumbs } from "./remotePaths";
import { folderPathKey } from "./paths";

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
  remoteHost?: string,
): PathCrumbsState => {
  const build = remoteHost ? (value: string) => remoteCrumbs(value).map(c => ({
    path: c.path, key: c.path, label: c.path === "/" ? remoteHost : c.name,
  })) : buildPathCrumbs;
  const key = remoteHost ? (value: string) => value : folderPathKey;
  if (!path) return { crumbs: [], activeIndex: -1 };
  const trailCrumbs = build(trailPath || path);
  const currentIndex = trailCrumbs.findIndex(crumb => key(crumb.path) === key(path));
  if (currentIndex !== -1) {
    return { crumbs: trailCrumbs, activeIndex: currentIndex };
  }
  const currentCrumbs = build(path);
  return { crumbs: currentCrumbs, activeIndex: currentCrumbs.length - 1 };
};

export const getNextTrailPath = (
  path: string,
  trailPath?: string | null,
  remoteHost?: string,
): string | null => {
  const { crumbs, activeIndex } = resolvePathCrumbs(path, trailPath, remoteHost);
  if (activeIndex < 0) return null;
  const next = crumbs[activeIndex + 1];
  return next?.path ?? null;
};
