// Reusable compact scroll button used by horizontally overflowing strips.
import type { ButtonHTMLAttributes } from "react";
import { PressButton } from "@/components/primitives/PressButton";

type HorizontalChevronButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  direction: "left" | "right";
  iconClassName?: string;
};

export const HorizontalChevronButton = ({
  direction,
  className,
  iconClassName,
  ...props
}: HorizontalChevronButtonProps) => {
  const path = direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6";

  return (
    <PressButton {...props} className={className}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className={iconClassName} fill="none">
        <path
          d={path}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </PressButton>
  );
};
