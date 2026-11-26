// Move through the history stacks once, even when jumping past several folders.
import type { TabHistory, TabHistoryDirection } from "@/types/tabs";

export const jumpThroughTabHistory = (
  history: TabHistory,
  direction: TabHistoryDirection,
  currentPath: string,
  offset: number,
  limit: number,
  expectedPath?: string,
) => {
  const from = history[direction];
  const index = from.length - 1 - offset;
  const destination = from[index];
  if (!destination || (expectedPath !== undefined && destination !== expectedPath)) return null;

  const to = direction === "back" ? history.forward : history.back;
  const current = currentPath;
  if (current) to.push(current);
  for (let i = from.length - 1; i > index; i -= 1) {
    to.push(from[i]);
  }
  // The opposite stack's next step is the folder immediately before this jump.
  from.length = index;
  if (to.length > limit) to.splice(0, to.length - limit);
  return destination;
};
