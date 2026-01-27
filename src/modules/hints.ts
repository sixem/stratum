// Sidebar hint templates for the rotating tips section.
export type Hint = {
  id: string;
  text: string;
};

export const HINTS: Hint[] = [
  { id: "escape-clear", text: "Press Escape to clear the current selection." },
  { id: "path-bar", text: "Use the path bar to jump directly to any folder." },
  { id: "right-click", text: "Right-click items to see available actions." },
  { id: "search-hotkey", text: "Press CTRL + F to focus search (press again to clear)." },
  { id: "new-tab", text: "Middle-click a path to open it in a new tab." },
  { id: "reorder-tabs", text: "Drag tabs to reorder them across the top bar." },
  { id: "refresh", text: "Hit F5 to rescan the current folder." },
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
