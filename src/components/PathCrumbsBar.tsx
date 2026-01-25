// Breadcrumb navigation for the current filesystem path.
import { Fragment, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { handleMiddleClick, normalizePath } from "@/lib";

type PathCrumb = {
  label: string;
  path: string;
  key: string;
};

type PathCrumbsBarProps = {
  path: string;
  // The deepest path visited within the current branch, used to show future crumbs.
  trailPath?: string | null;
  dropTargetPath?: string | null;
  onNavigate: (path: string) => void;
  onNavigateNewTab?: (path: string) => void;
};

const buildCrumbs = (path: string): PathCrumb[] => {
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
const resolveCrumbs = (path: string, trailPath?: string | null) => {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return { crumbs: buildCrumbs(path), activeIndex: -1 };
  }
  const trimmedTrail = trailPath?.trim();
  const displayPath = trimmedTrail ? trimmedTrail : path;
  const trailCrumbs = buildCrumbs(displayPath);
  const currentKey = normalizePath(trimmedPath);
  const currentIndex = trailCrumbs.findIndex(
    (crumb) => normalizePath(crumb.path) === currentKey,
  );
  if (currentIndex !== -1) {
    return { crumbs: trailCrumbs, activeIndex: currentIndex };
  }
  const currentCrumbs = buildCrumbs(path);
  return { crumbs: currentCrumbs, activeIndex: currentCrumbs.length - 1 };
};

export function PathCrumbsBar({
  path,
  trailPath,
  dropTargetPath,
  onNavigate,
  onNavigateNewTab,
}: PathCrumbsBarProps) {
  const { crumbs, activeIndex } = useMemo(
    () => resolveCrumbs(path, trailPath),
    [path, trailPath],
  );
  const trimmedPath = path.trim();
  const isBarDropTarget = Boolean(trimmedPath && dropTargetPath === trimmedPath);

  const handleCrumbMouseDown = (event: ReactMouseEvent, crumbPath: string) => {
    if (!onNavigateNewTab) return;
    handleMiddleClick(event, () => onNavigateNewTab(crumbPath));
  };

  // Treat the crumb bar and each crumb as directory drop targets.
  // Future crumbs stay interactive while being visually dimmed.
  return (
    <div
      className="crumbbar"
      role="navigation"
      aria-label="Current path"
      data-is-dir="true"
      data-path={path}
      data-drop-target={isBarDropTarget ? "true" : "false"}
    >
      <div className="crumbs">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.key}>
            <button
              type="button"
              className="crumb"
              data-is-dir="true"
              data-path={crumb.path}
              data-drop-target={dropTargetPath === crumb.path ? "true" : "false"}
              data-future={
                activeIndex >= 0 && index > activeIndex ? "true" : "false"
              }
              onClick={() => onNavigate(crumb.path)}
              onMouseDown={(event) => handleCrumbMouseDown(event, crumb.path)}
              aria-current={index === activeIndex ? "page" : undefined}
            >
              {crumb.label}
            </button>
            {index < crumbs.length - 1 ? (
              <span className="crumb-sep">{"\\"}</span>
            ) : null}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
