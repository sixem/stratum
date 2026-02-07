// Sidebar hint templates for the rotating tips section.
export type Hint = {
  id: string;
  text: string;
};

export const HINTS: Hint[] = [
  { id: "escape-clear", text: "Press Escape to clear the current selection." },
  { id: "path-bar", text: "Use the path bar to jump directly to any folder." },
  { id: "search-hotkey", text: "Press CTRL + F to focus search (press again to clear)." },
  { id: "new-tab", text: "Middle-click a path to open it in a new tab." },
  { id: "smart-tab", text: "Double-tap Tab to jump to the top or bottom of the view." },
  { id: "reorder-tabs", text: "Drag tabs to reorder them across the top bar." },
  { id: "refresh", text: "Hit F5 or CTRL + R to rescan the current folder." },
  { id: "hide-tips", text: "You can hide these tips in the settings." },
];

const FALLBACK_HINT: Hint = {
  id: "fallback",
  text: "Use the path bar to jump directly to any folder.",
};

export const pickRandomHint = () => {
  if (HINTS.length === 0) return FALLBACK_HINT;
  const index = Math.floor(Math.random() * HINTS.length);
  return HINTS[index] ?? FALLBACK_HINT;
};

let sessionHint: Hint | null = null;

export const getSessionHint = () => {
  if (!sessionHint) {
    sessionHint = pickRandomHint();
  }
  return sessionHint;
};

export const refreshSessionHint = () => {
  if (HINTS.length <= 1) {
    sessionHint = pickRandomHint();
    return sessionHint;
  }
  const currentId = sessionHint?.id;
  let next = pickRandomHint();
  let attempts = 0;
  while (next.id === currentId && attempts < 4) {
    next = pickRandomHint();
    attempts += 1;
  }
  sessionHint = next;
  return sessionHint;
};
