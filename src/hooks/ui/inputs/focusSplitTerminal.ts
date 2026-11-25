// Scope the focus target to the split that owns the folder view.
export function focusSplitTerminal(view: HTMLElement | null) {
  const split = view?.parentElement;
  if (!split?.matches(".terminal-split-layout[data-paired]")) return false;
  const terminal = split.querySelector<HTMLElement>("[data-terminal]");
  if (!terminal) return false;
  terminal.focus({ preventScroll: true });
  return terminal.contains(document.activeElement);
}
