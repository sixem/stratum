// Shared shell for app-owned window chrome rows with a draggable center surface.
import type { ReactNode } from "react";
import { WindowDragRegion } from "./WindowDragRegion";

type WindowChromeBarProps = {
  shellClassName: string;
  dragRegionClassName: string;
  windowControlsClassName: string;
  leftSlot?: ReactNode;
  centerSlot?: ReactNode;
  rightSlot?: ReactNode;
  windowControlsSlot?: ReactNode;
};

const joinClasses = (...classNames: Array<string | undefined>) => {
  return classNames.filter(Boolean).join(" ");
};

export const WindowChromeBar = ({
  shellClassName,
  dragRegionClassName,
  windowControlsClassName,
  leftSlot,
  centerSlot,
  rightSlot,
  windowControlsSlot,
}: WindowChromeBarProps) => {
  return (
    <div className={joinClasses("window-chrome-bar", shellClassName)}>
      <WindowDragRegion className={joinClasses("window-chrome-bar-drag", dragRegionClassName)}>
        {leftSlot}
        {centerSlot}
        {rightSlot}
      </WindowDragRegion>
      {windowControlsSlot ? (
        <div className={joinClasses("window-chrome-bar-controls", windowControlsClassName)}>
          {windowControlsSlot}
        </div>
      ) : null}
    </div>
  );
};
