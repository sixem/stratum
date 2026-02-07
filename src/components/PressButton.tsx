// Button helper that fires on pointer down for snappier UI, while keeping keyboard clicks intact.
import type { ButtonHTMLAttributes, MouseEvent, PointerEvent } from "react";
import { useRef } from "react";

type PressButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pressOnPointerDown?: boolean;
};

export const PressButton = ({
  pressOnPointerDown = true,
  onPointerDown,
  onClick,
  ...props
}: PressButtonProps) => {
  const handledRef = useRef(false);
  const handledTimerRef = useRef<number | null>(null);

  const clearHandled = () => {
    handledRef.current = false;
    if (handledTimerRef.current != null) {
      window.clearTimeout(handledTimerRef.current);
      handledTimerRef.current = null;
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    if (!pressOnPointerDown) return;
    if (event.button !== 0) return;
    if (event.defaultPrevented) return;
    handledRef.current = true;
    if (handledTimerRef.current != null) {
      window.clearTimeout(handledTimerRef.current);
    }
    handledTimerRef.current = window.setTimeout(() => {
      clearHandled();
    }, 800);
    event.currentTarget.click();
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (handledRef.current && event.detail > 0) {
      clearHandled();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!handledRef.current) {
      onClick?.(event);
      return;
    }
    // Allow keyboard or programmatic clicks while suppressing the upcoming mouseup click.
    onClick?.(event);
  };

  return (
    <button
      {...props}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    />
  );
};
