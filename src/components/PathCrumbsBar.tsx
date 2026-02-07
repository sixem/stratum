// Breadcrumb navigation for the current filesystem path.
import { Fragment, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { handleMiddleClick, resolvePathCrumbs } from "@/lib";
import { PressButton } from "./PressButton";

type PathCrumbsBarProps = {
  path: string;
  // The deepest path visited within the current branch, used to show future crumbs.
  trailPath?: string | null;
  dropTargetPath?: string | null;
  onNavigate: (path: string) => void;
  onNavigateNewTab?: (path: string) => void;
};

export const PathCrumbsBar = ({
  path,
  trailPath,
  dropTargetPath,
  onNavigate,
  onNavigateNewTab,
}: PathCrumbsBarProps) => {
  const { crumbs, activeIndex } = useMemo(
    () => resolvePathCrumbs(path, trailPath),
    [path, trailPath],
  );
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return null;
  }
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
            <PressButton
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
            </PressButton>
            {index < crumbs.length - 1 ? (
              <span className="crumb-sep">{"\\"}</span>
            ) : null}
          </Fragment>
        ))}
      </div>
    </div>
  );
};
