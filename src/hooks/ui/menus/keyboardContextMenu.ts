import type { ShellMenuTarget } from "@/api";
import type { PlaceContextTarget } from "@/types";

type MenuRequest = {
  target: ShellMenuTarget | null;
  place?: PlaceContextTarget;
  listHeader?: boolean;
  point: { x: number; y: number };
};

export const getFileCommandFocus = (main: HTMLElement | null, forContextMenu = false) => {
  if (!main) return null;
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement || main.contains(active)) {
    return "view" as const;
  }
  const element = active.closest<HTMLElement>("[data-context-place]");
  const hostId = element?.dataset.placeHost ?? element?.dataset.dropProfile;
  if (hostId && !forContextMenu) return null;
  const path = element?.dataset.remotePlacePath || element?.dataset.dropPath || element?.dataset.path || "";
  const source = element?.dataset.contextPlace as PlaceContextTarget["source"] | undefined;
  const tabId = source === "tab" ? element?.dataset.tabId : undefined;
  if (!element || !source || (!path && !(forContextMenu && tabId))) return null;
  const place: PlaceContextTarget = { path, source, name: element.dataset.contextName || path };
  if (hostId) place.hostId = hostId;
  if (tabId) place.tabId = tabId;
  return { element, place };
};

// Arrow keys move Stratum's selection without moving DOM focus between virtual rows.
export const getKeyboardMenuRequest = (
  main: HTMLElement,
  currentPath: string,
  selectedPaths: string[],
  parentPath: string | null,
): MenuRequest | null => {
  const focus = getFileCommandFocus(main, true);
  if (!focus) return null;
  if (focus !== "view") {
    const rect = focus.element.getBoundingClientRect();
    return {
      target: !focus.place.hostId && focus.place.path ? { paths: [focus.place.path] } : null,
      place: focus.place,
      point: { x: rect.left, y: rect.bottom },
    };
  }
  if (!currentPath) return null;

  const listHeader = document.activeElement?.closest("[data-list-header]");
  if (listHeader && main.contains(listHeader)) {
    const anchor = document.activeElement?.getBoundingClientRect() ?? listHeader.getBoundingClientRect();
    return {
      target: { backgroundPath: currentPath },
      listHeader: true,
      point: { x: anchor.left, y: anchor.bottom },
    };
  }

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
