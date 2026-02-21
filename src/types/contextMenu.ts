// Shared shapes for context menu state and items.
import type { FileEntry } from "./fs";

export type EntryContextTarget = Pick<FileEntry, "name" | "path" | "isDir">;

export type PlaceContextSource =
  | "sidebar-place"
  | "sidebar-recent"
  | "crumb"
  | "tab"
  | "entry";

export type PlaceContextTarget = {
  name: string;
  path: string;
  source: PlaceContextSource;
};

export type ContextMenuIcon =
  | "open-external"
  | "convert"
  | "quick-convert"
  | "copy"
  | "delete";

export type ContextMenuItem =
  | {
      kind?: "item";
      id: string;
      label: string;
      onSelect: () => void;
      active?: boolean;
      hint?: string;
      disabled?: boolean;
      icon?: ContextMenuIcon;
    }
  | {
      kind: "submenu";
      id: string;
      label: string;
      items: ContextMenuItem[];
      hint?: string;
      disabled?: boolean;
      icon?: ContextMenuIcon;
    }
  | {
      kind: "divider";
      id: string;
    };
