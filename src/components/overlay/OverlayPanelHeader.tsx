// Shared overlay header with a draggable title row.
//
// Settings and indexed search both use this chrome now so the visual treatment
// and window-drag behavior stay aligned.
import type { MouseEvent, ReactNode } from "react";
import { WindowDragRegion } from "@/components/primitives";

type OverlayPanelHeaderProps = {
  title: string;
  titleId?: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  actionsClassName?: string;
  preserveFocusOnMouseDown?: boolean;
};

const joinClassNames = (...values: Array<string | undefined>) =>
  values.filter((value) => value && value.length > 0).join(" ");

const preserveFocusOnHeaderChrome = (event: MouseEvent<HTMLDivElement>) => {
  if (
    event.button === 0 &&
    event.target instanceof Element &&
    !event.target.closest(".overlay-panel-header-actions")
  ) {
    // Prevent the browser from moving focus while the mouse event bubbles to Tauri.
    event.preventDefault();
  }
};

export const OverlayPanelHeader = ({
  title,
  titleId,
  subtitle,
  actions,
  className,
  titleClassName,
  subtitleClassName,
  actionsClassName,
  preserveFocusOnMouseDown,
}: OverlayPanelHeaderProps) => {
  return (
    <div
      className={joinClassNames("overlay-panel-header", className)}
      onMouseDown={preserveFocusOnMouseDown ? preserveFocusOnHeaderChrome : undefined}
    >
      <div className="overlay-panel-header-top">
        <WindowDragRegion className="overlay-panel-header-drag">
          <h2
            className={joinClassNames("overlay-panel-header-title", titleClassName)}
            id={titleId}
          >
            {title}
          </h2>
          {subtitle ? (
            <p className={joinClassNames("overlay-panel-header-subtitle", subtitleClassName)}>
              {subtitle}
            </p>
          ) : null}
        </WindowDragRegion>
        {actions ? (
          <div className={joinClassNames("overlay-panel-header-actions", actionsClassName)}>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
};
