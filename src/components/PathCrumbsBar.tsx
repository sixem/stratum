// Breadcrumb navigation for the current filesystem path.
import { Fragment, useMemo } from "react";

type PathCrumb = {
  label: string;
  path: string;
  key: string;
};

type PathCrumbsBarProps = {
  path: string;
  onNavigate: (path: string) => void;
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

export function PathCrumbsBar({ path, onNavigate }: PathCrumbsBarProps) {
  const crumbs = useMemo(() => buildCrumbs(path), [path]);

  return (
    <div className="crumbbar" role="navigation" aria-label="Current path">
      <div className="crumbs">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.key}>
            <button
              type="button"
              className="crumb"
              onClick={() => onNavigate(crumb.path)}
              aria-current={index === crumbs.length - 1 ? "page" : undefined}
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
