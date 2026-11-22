// Resolve a pointer position to the tab strip for that pane.
const openByStrip = new WeakMap<HTMLElement, (path: string) => void>();

export const registerTabLocationDrop = (strip: HTMLElement, open: (path: string) => void) => {
  openByStrip.set(strip, open);
  return () => { openByStrip.delete(strip); };
};

export const getTabLocationDropTarget = (x: number, y: number, allowExistingTabs = true) => {
  const hit = document.elementFromPoint(x, y);
  if (hit?.closest("[data-drop-submenu-tab-id]")) return null;
  const strip = hit?.closest<HTMLElement>("[data-tab-location-strip]");
  if (!strip || !openByStrip.has(strip)) return null;
  const bounds = strip.getBoundingClientRect();
  if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) return null;
  // An existing folder tab is also a filesystem transfer destination.
  if (!allowExistingTabs && hit?.closest('[data-drop-kind="tab"][data-tab-kind="directory"]')) return null;
  return strip;
};

export const openDroppedLocation = (strip: HTMLElement, path: string) => openByStrip.get(strip)?.(path);

export const createTabLocationHover = () => {
  let hovered: HTMLElement | null = null;
  return (strip: HTMLElement | null) => {
    if (hovered === strip) return false;
    hovered?.removeAttribute("data-location-drop-hover");
    strip?.setAttribute("data-location-drop-hover", "true");
    hovered = strip;
    return true;
  };
};
