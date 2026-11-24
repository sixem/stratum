// Icon button with tooltip for toolbar actions.
import type { MouseEventHandler, ReactNode } from "react";
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
  onContextMenu?: MouseEventHandler<HTMLButtonElement>;
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
  onContextMenu,
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
      onContextMenu={onContextMenu}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      aria-haspopup={onContextMenu ? "menu" : undefined}
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
