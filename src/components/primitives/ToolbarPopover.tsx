// Shared panel, heading, and footer for compact toolbar lists.
import type { ComponentPropsWithRef, ReactNode } from "react";

type ToolbarPopoverProps = Omit<ComponentPropsWithRef<"div">, "title"> & {
  heading: string;
  headerAction?: ReactNode;
  footer?: ReactNode;
};

export const ToolbarPopover = ({
  heading, headerAction, footer, className, children, ...props
}: ToolbarPopoverProps) => (
  <div {...props} className={`toolbar-popover ${className ?? ""}`} data-window-drag-ignore="true">
    <div className="toolbar-popover-header">
      <div className="toolbar-popover-title">{heading}</div>
      {headerAction}
    </div>
    {children}
    {footer ? <div className="toolbar-popover-footer">{footer}</div> : null}
  </div>
);
