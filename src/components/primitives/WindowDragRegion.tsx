// Marks a surface as draggable when running inside a Tauri desktop window.
import type { ComponentPropsWithoutRef } from "react";

type WindowDragRegionProps = ComponentPropsWithoutRef<"div">;

export const WindowDragRegion = ({
  className,
  children,
  ...props
}: WindowDragRegionProps) => {
  const classes = className ? `window-drag-region ${className}` : "window-drag-region";

  return (
    <div {...props} className={classes} data-tauri-drag-region="">
      {children}
    </div>
  );
};
