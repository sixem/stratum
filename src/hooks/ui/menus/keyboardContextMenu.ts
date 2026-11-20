import type { ShellMenuTarget } from "@/api";
import type { PlaceContextTarget } from "@/types";

type MenuRequest = {
  target: ShellMenuTarget;
  place?: PlaceContextTarget;
  point: { x: number; y: number };
};

export const getFileCommandFocus = (main: HTMLElement | null) => {
  if (!main) return null;
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement || main.contains(active)) {
    return "view" as const;
  }
  const element = active.closest<HTMLElement>("[data-context-place]");
  const path = element?.dataset.dropPath || element?.dataset.path;
  const source = element?.dataset.contextPlace as PlaceContextTarget["source"] | undefined;
  if (!element || !path || !source) return null;
  return { element, place: { path, source, name: element.dataset.contextName || path } };
};

// Arrow keys move Stratum's selection without moving DOM focus between virtual rows.
export const getKeyboardMenuRequest = (
  main: HTMLElement,
  currentPath: string,
  selectedPaths: string[],
  parentPath: string | null,
): MenuRequest | null => {
  const focus = getFileCommandFocus(main);
  if (!focus) return null;
  if (focus !== "view") {
    const rect = focus.element.getBoundingClientRect();
    return {
      target: { paths: [focus.place.path] },
      place: focus.place,
      point: { x: rect.left, y: rect.bottom },
    };
  }
  if (!currentPath) return null;

  const focused = document.activeElement?.closest<HTMLElement>('[data-selectable="true"]');
  const focusedPath = focused?.dataset.path;
  let paths = selectedPaths;
  let anchor: Element | null = null;
  if (selectedPaths.length) {
    anchor = focusedPath && paths.includes(focusedPath) ? focused ?? null :
      main.querySelector(`[data-selectable="true"][data-path="${CSS.escape(paths[0])}"]`);
  } else if (focusedPath && focusedPath !== parentPath) {
    paths = [focusedPath];
    anchor = focused ?? null;
  }
  const pane = main.getBoundingClientRect();
  const row = anchor?.getBoundingClientRect();
  const point = row && row.top < pane.bottom && row.bottom > pane.top
    ? { x: Math.max(pane.left, row.left) + 4, y: Math.min(row.bottom, pane.bottom - 4) }
    : { x: pane.left + 8, y: pane.top + 8 };
  return { target: paths.length ? { paths } : { backgroundPath: currentPath }, point };
};
