// DOM hit testing for file drop targets (tabs and folder entries).
export type DropTarget = {
  kind: "entry" | "tab" | "tab-subfolder";
  path: string;
  tabId?: string | null;
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
  const entryTarget = element?.closest<HTMLElement>("[data-is-dir=\"true\"][data-path]");
  const path = entryTarget?.dataset.path ?? "";
  if (!path.trim()) {
    return { target: null, element: null };
  }
  return { target: { kind: "entry", path }, element: entryTarget ?? null };
};

export const getDropTargetFromPoint = (x: number, y: number): DropTarget | null =>
  getDropTargetHit(x, y).target;
