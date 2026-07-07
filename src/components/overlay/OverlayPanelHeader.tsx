// Shared overlay header with a draggable title row.
//
// Settings and indexed search both use this chrome now so the visual treatment
// and window-drag behavior stay aligned.
import type { ReactNode } from "react";
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
};

const joinClassNames = (...values: Array<string | undefined>) =>
  values.filter((value) => value && value.length > 0).join(" ");

export const OverlayPanelHeader = ({
  title,
  titleId,
  subtitle,
  actions,
  className,
  titleClassName,
  subtitleClassName,
  actionsClassName,
}: OverlayPanelHeaderProps) => {
  return (
    <div className={joinClassNames("overlay-panel-header", className)}>
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
