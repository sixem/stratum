// Shared shapes for context menu state and items.
import type { FileEntry } from "./fs";

export type EntryContextTarget = Pick<FileEntry, "name" | "path" | "isDir">;

export type ContextMenuItem =
  | {
      kind?: "item";
      id: string;
      label: string;
      onSelect: () => void;
      active?: boolean;
      hint?: string;
      disabled?: boolean;
    }
  | {
      kind: "submenu";
      id: string;
      label: string;
      items: ContextMenuItem[];
      hint?: string;
      disabled?: boolean;
    }
  | {
      kind: "divider";
      id: string;
    };
