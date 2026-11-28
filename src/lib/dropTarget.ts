// DOM hit testing for file drop targets (tabs and folder entries).
export type DropTarget = {
  tabId?: string | null;
  pane?: "main" | "bottom";
  profileId?: string;
  sessionId?: number;
  // For a submenu row, keep the tab's displayed folder alongside the actual destination.
  tabPath?: string;
} & (
  | { kind: "entry" | "tab" | "tab-destination" | "pane" | "remote-pane" | "remote-entry" | "remote-crumb" | "remote-tab"; path: string }
  | { kind: "tab-submenu" }
);

export type DropTargetSubmenuItem = {
  name: string;
  path: string;
  parent?: true;
};

export type TabDropSubmenuState = {
  hostTabId: string | null;
  hostPath: string | null;
  items: DropTargetSubmenuItem[];
  loading: boolean;
  remote?: { profileId: string; sessionId: number };
  error?: string;
};

export type DropTargetHit = {
  target: DropTarget | null;
  element: HTMLElement | null;
};

export const getDropTargetHit = (x: number, y: number): DropTargetHit => {
  const element = document.elementFromPoint(x, y) as HTMLElement | null;
  if (element?.closest("[data-pending-removal]")) return { target: null, element };
  const tabDestination = element?.closest<HTMLElement>(
    "[data-drop-kind=\"tab-destination\"][data-drop-path]",
  );
  const destinationPath = tabDestination?.dataset.dropPath ?? "";
  if (destinationPath.trim()) {
    if (tabDestination?.dataset.dropProfile) {
      const { dropProfile, dropHostPath, dropSession, dropTabId } = tabDestination.dataset;
      return { target: dropHostPath && dropSession && dropTabId ? {
        kind: "remote-tab", path: destinationPath, profileId: dropProfile, sessionId: Number(dropSession),
        tabPath: dropHostPath, tabId: dropTabId,
      } : null, element: tabDestination };
    }
    return {
      target: {
        kind: "tab-destination",
        path: destinationPath,
        tabId: tabDestination?.dataset.dropTabId ?? null,
      },
      element: tabDestination ?? null,
    };
  }
  // The gap, heading, and scrollbar keep the submenu open but accept no drops.
  const tabSubmenu = element?.closest<HTMLElement>("[data-drop-submenu-tab-id]");
  if (tabSubmenu?.dataset.dropSubmenuTabId) {
    return {
      target: { kind: "tab-submenu", tabId: tabSubmenu.dataset.dropSubmenuTabId },
      element: tabSubmenu,
    };
  }
  const tabTarget = element?.closest<HTMLElement>("[data-drop-kind=\"tab\"][data-drop-path]");
  const tabPath = tabTarget?.dataset.dropPath ?? "";
  if (tabPath.trim()) {
    return {
      target: {
        kind: "tab",
        path: tabPath,
        tabId: tabTarget?.dataset.dropId ?? null,
      },
      element: tabTarget ?? null,
    };
  }
  const remoteTab = element?.closest<HTMLElement>('[data-drop-kind="remote-tab"][data-drop-path][data-drop-profile]');
  if (remoteTab?.dataset.dropPath && remoteTab.dataset.dropProfile) {
    return { target: { kind: "remote-tab", path: remoteTab.dataset.dropPath, profileId: remoteTab.dataset.dropProfile, tabId: remoteTab.dataset.dropId }, element: remoteTab };
  }
  // Remote breadcrumbs are outside the file pane and must never be treated
  // as local Windows paths. Keep their exact POSIX spelling and host identity.
  const remoteCrumb = element?.closest<HTMLElement>("[data-remote-crumb-path]");
  const remoteCrumbBar = remoteCrumb?.closest<HTMLElement>("[data-remote-crumb-profile][data-drop-pane]");
  const crumbPane = remoteCrumbBar?.dataset.dropPane;
  const crumbPath = remoteCrumb?.dataset.remoteCrumbPath;
  const crumbProfile = remoteCrumbBar?.dataset.remoteCrumbProfile;
  if (remoteCrumb) {
    const sessionId = Number(remoteCrumbBar?.dataset.remoteCrumbSession);
    const target: DropTarget | null = crumbPath && crumbProfile && Number.isInteger(sessionId) && (crumbPane === "main" || crumbPane === "bottom")
      ? { kind: "remote-crumb", path: crumbPath, pane: crumbPane, profileId: crumbProfile, sessionId } : null;
    return { target, element: remoteCrumb };
  }
  const pane = element?.closest<HTMLElement>("[data-pane-path]");
  const paneId = pane?.dataset.filePane === "bottom" ? "bottom" : "main";
  const remoteFolder = element?.closest<HTMLElement>(".remote-folder[data-remote-folder-path]");
  if (pane && remoteFolder && pane.contains(remoteFolder)) {
    const directory = element?.closest<HTMLElement>('[data-is-dir="true"][data-remote-path]');
    // Following a remote link is an explicit navigation action, not a drop target.
    if (directory?.dataset.remoteSymlink === "true") return { target: null, element: directory };
    const path = directory?.dataset.remotePath ?? remoteFolder.dataset.remoteFolderPath;
    if (path) return { target: { kind: directory ? "remote-entry" : "remote-pane", pane: paneId, path }, element: directory ?? remoteFolder };
  }
  if (pane && !pane.dataset.panePath) return { target: null, element: null };
  const entryTarget = element?.closest<HTMLElement>("[data-is-dir=\"true\"][data-path]");
  const path = entryTarget?.dataset.path ?? "";
  if (!path.trim()) {
    if (pane?.dataset.panePath) return { target: { kind: "pane", pane: paneId, path: pane.dataset.panePath }, element: pane };
    return { target: null, element: null };
  }
  const dropPane = element?.closest<HTMLElement>("[data-drop-pane]")?.dataset.dropPane;
  const entryPane = dropPane === "bottom" || dropPane === "main" ? dropPane : undefined;
  return { target: { kind: "entry", pane: pane ? paneId : entryPane, path }, element: entryTarget ?? null };
};

export const getDropTargetFromPoint = (x: number, y: number): DropTarget | null =>
  getDropTargetHit(x, y).target;
