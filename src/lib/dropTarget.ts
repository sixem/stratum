// DOM hit testing for file drop targets (tabs and folder entries).
export type DropTarget = {
  kind: "entry" | "tab" | "tab-subfolder" | "pane";
  path: string;
  tabId?: string | null;
  pane?: "main" | "bottom";
};

export type DropTargetSubmenuItem = {
  name: string;
  path: string;
};

export type TabDropSubmenuState = {
  hostTabId: string | null;
  hostPath: string | null;
  items: DropTargetSubmenuItem[];
  loading: boolean;
};

export type DropTargetHit = {
  target: DropTarget | null;
  element: HTMLElement | null;
};

export const getDropTargetHit = (x: number, y: number): DropTargetHit => {
  const element = document.elementFromPoint(x, y) as HTMLElement | null;
  const tabSubfolderTarget = element?.closest<HTMLElement>(
    "[data-drop-kind=\"tab-subfolder\"][data-drop-path]",
  );
  const tabSubfolderPath = tabSubfolderTarget?.dataset.dropPath ?? "";
  if (tabSubfolderPath.trim()) {
    return {
      target: {
        kind: "tab-subfolder",
        path: tabSubfolderPath,
        tabId: tabSubfolderTarget?.dataset.dropTabId ?? null,
      },
      element: tabSubfolderTarget ?? null,
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
  const pane = element?.closest<HTMLElement>("[data-pane-path]");
  const paneId = pane?.dataset.filePane === "bottom" ? "bottom" : "main";
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
