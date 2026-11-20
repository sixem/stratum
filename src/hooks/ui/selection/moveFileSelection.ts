// Keyboard selection follows row order in a list and column geometry in a grid.
import type { ViewMode } from "@/types";

type Modifiers = Pick<KeyboardEvent, "shiftKey" | "ctrlKey" | "metaKey" | "altKey">;
type ArrowEvent = Modifiers & Pick<KeyboardEvent, "key" | "isComposing">;

export function moveFileSelection(
  event: ArrowEvent,
  viewMode: ViewMode,
  gridColumns: number,
  items: string[],
  currentIndex: number,
  selectItem: (path: string, index: number, modifiers: Modifiers) => void,
  scrollTo: (index: number) => void,
) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  if (!items.length) return false;
  const grid = viewMode === "thumbs";
  const rowSize = grid ? Math.max(1, gridColumns) : 1;
  let step: number;
  switch (event.key) {
    case "ArrowUp": step = -rowSize; break;
    case "ArrowDown": step = rowSize; break;
    case "ArrowLeft": if (!grid) return false; step = -1; break;
    case "ArrowRight": if (!grid) return false; step = 1; break;
    default: return false;
  }

  const lastIndex = items.length - 1;
  const next = currentIndex < 0
    ? (step > 0 ? 0 : lastIndex)
    : Math.min(lastIndex, Math.max(0, currentIndex + step));
  if (next !== currentIndex) {
    selectItem(items[next], next, event);
    scrollTo(next);
  }
  return true;
}
