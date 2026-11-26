// Breadcrumb navigation for the current filesystem path.
import { Fragment, useMemo, useRef } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { handleMiddleClick, resolvePathCrumbs } from "@/lib";
import { useHorizontalWheelScroll } from "@/hooks";
import { useLocationDrag } from "@/hooks/ui/inputs/useLocationDrag";
import { PressButton } from "@/components/primitives/PressButton";
import { TerminalSplitControls } from "@/components/terminal/TerminalSplitControls";
import type { PlaceContextTarget } from "@/types";

type PathCrumbsBarProps = {
  path: string;
  remoteHost?: string;
  pane?: "main" | "bottom";
  reserveSpace?: boolean;
  // The deepest path visited within the current branch, used to show future crumbs.
  trailPath?: string | null;
  dropTargetPath?: string | null;
  onNavigate: (path: string) => void;
  onNavigateNewTab?: (path: string) => void;
  onCrumbContextMenu?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
  onCrumbContextMenuDown?: (event: ReactPointerEvent, target: PlaceContextTarget) => void;
};

export const PathCrumbsBar = ({
  path,
  pane = "main",
  remoteHost,
  reserveSpace = false,
  trailPath,
  dropTargetPath,
  onNavigate,
  onNavigateNewTab,
  onCrumbContextMenu,
  onCrumbContextMenuDown,
}: PathCrumbsBarProps) => {
  const { crumbs, activeIndex } = useMemo(
    () => resolvePathCrumbs(path, trailPath, remoteHost),
    [path, trailPath, remoteHost],
  );
  const trimmedPath = path.trim();
  const crumbsRef = useRef<HTMLDivElement>(null);
  const locationDrag = useLocationDrag();
  useHorizontalWheelScroll(crumbsRef, Boolean(trimmedPath));
  if (!trimmedPath) {
    return reserveSpace ? <div className="crumbbar" aria-hidden="true" /> : null;
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
      aria-label={pane === "bottom" ? "Bottom pane path" : "Current path"}
      data-drop-pane={pane}
      data-is-dir={remoteHost ? undefined : "true"}
      data-path={remoteHost ? undefined : path}
      data-drop-target={isBarDropTarget ? "true" : "false"}
      {...(remoteHost ? {} : locationDrag)}
    >
      <div className="crumbs" ref={crumbsRef}>
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.key}>
            <PressButton
              type="button"
              className="crumb"
              data-context-place={remoteHost ? undefined : "crumb"}
              data-context-name={crumb.label}
              data-is-dir={remoteHost ? undefined : "true"}
              data-path={remoteHost ? undefined : crumb.path}
              data-location-path={remoteHost ? undefined : crumb.path}
              data-drop-target={dropTargetPath === crumb.path ? "true" : "false"}
              data-future={
                activeIndex >= 0 && index > activeIndex ? "true" : "false"
              }
              onClick={() => onNavigate(crumb.path)}
              pressOnPointerDown={false}
              onMouseDown={(event) => handleCrumbMouseDown(event, crumb.path)}
              onPointerDown={(event) => {
                if (event.button !== 2) return;
                onCrumbContextMenuDown?.(event, {
                  name: crumb.label,
                  path: crumb.path,
                  source: "crumb",
                });
              }}
              onPointerUp={(event) => {
                if (event.button !== 2) return;
                onCrumbContextMenu?.(event, {
                  name: crumb.label,
                  path: crumb.path,
                  source: "crumb",
                });
              }}
              onContextMenu={(event) => event.preventDefault()}
              aria-current={index === activeIndex ? "page" : undefined}
            >
              {crumb.label}
            </PressButton>
            {index < crumbs.length - 1 ? (
              <span className="crumb-sep">{remoteHost ? "/" : "\\"}</span>
            ) : null}
          </Fragment>
        ))}
      </div>
      {!remoteHost && <TerminalSplitControls pane={pane} />}
    </div>
  );
};
