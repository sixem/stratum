// Icon button with tooltip for toolbar actions.
import type { ReactNode } from "react";
import { PressButton } from "@/components/primitives/PressButton";
import { TooltipWrapper } from "@/components/overlay/Tooltip";

type ToolbarIconButtonProps = {
  label: string;
  ariaLabel?: string;
  active?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  pressOnPointerDown?: boolean;
  onClick: () => void;
  tooltipDelayMs?: number;
  children: ReactNode;
};

export const ToolbarIconButton = ({
  label,
  ariaLabel = label,
  active = false,
  disabled = false,
  pressed,
  pressOnPointerDown,
  onClick,
  tooltipDelayMs,
  children,
}: ToolbarIconButtonProps) => {
  const button = (
    <PressButton
      type="button"
      className={`view-btn${active ? " is-active" : ""}`}
      disabled={disabled}
      pressOnPointerDown={pressOnPointerDown}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={pressed}
    >
      {children}
    </PressButton>
  );

  return (
    <TooltipWrapper text={label} delayMs={tooltipDelayMs}>
      {disabled ? <span className="toolbar-icon-tooltip-anchor">{button}</span> : button}
    </TooltipWrapper>
  );
};
