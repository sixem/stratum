// Icon button with tooltip for toolbar actions.
import type { ReactNode } from "react";
import { PressButton } from "./PressButton";
import { TooltipWrapper } from "./Tooltip";

type ToolbarIconButtonProps = {
  label: string;
  active?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
};

export const ToolbarIconButton = ({
  label,
  active = false,
  pressed,
  onClick,
  children,
}: ToolbarIconButtonProps) => {
  return (
    <TooltipWrapper text={label}>
      <PressButton
        type="button"
        className={`view-btn${active ? " is-active" : ""}`}
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
      >
        {children}
      </PressButton>
    </TooltipWrapper>
  );
};
