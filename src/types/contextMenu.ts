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
  tabId?: string;
};

export type ContextMenuIcon =
  | "open"
  | "open-external"
  | "open-folder"
  | "open-gallery"
  | "open-new-tab"
  | "open-with"
  | "new-folder"
  | "new-file"
  | "paste"
  | "paste-into-folder"
  | "terminal"
  | "pin"
  | "unpin"
  | "add"
  | "remove"
  | "convert"
  | "quick-convert"
  | "cut"
  | "copy"
  | "delete"
  | "rename"
  | "properties"
  | "more-options";

export type ContextMenuItem =
  | {
      kind?: "item";
      id: string;
      label: string;
      onSelect: () => void;
      active?: boolean;
      hint?: string;
      wrapLabel?: boolean;
      disabled?: boolean;
      icon?: ContextMenuIcon;
      iconUrl?: string;
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
