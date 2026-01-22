import type { MouseEvent as ReactMouseEvent } from "react";

// Middle-click helper used for opening items in new tabs.
export const handleMiddleClick = (event: ReactMouseEvent, action: () => void) => {
  if (event.button !== 1) return false;
  event.preventDefault();
  event.stopPropagation();
  action();
  return true;
};
