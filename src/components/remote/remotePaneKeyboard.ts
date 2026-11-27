// The breadcrumb may live above the sidebar or beside it, but belongs to one pane.
type Pane = "main" | "bottom";
type DocumentRoots = Pick<Document, "body" | "documentElement">;

export function isRemotePaneShortcutFocus(pane: Pane, active: Element | null, roots: DocumentRoots): boolean {
  if (!active || active === roots.body || active === roots.documentElement) return true;
  const breadcrumb = active.closest<HTMLElement>("[data-breadcrumb-pane]");
  if (breadcrumb) return breadcrumb.dataset.breadcrumbPane === pane;
  return Boolean(active.closest(pane === "main" ? '.topstack, [data-file-pane="main"]' : ".bottom-pane"));
}

export function isRemotePaneActive(pane: Pane, bottomActive: boolean): boolean {
  return (pane === "bottom") === bottomActive;
}

export function hasVisibleShortcutOverlay(root: Pick<Document, "querySelectorAll">): boolean {
  return Array.from(root.querySelectorAll('[role="dialog"], .context-menu[data-open="true"]'))
    .some(element => !element.closest("[inert]") && element.getClientRects().length > 0);
}
