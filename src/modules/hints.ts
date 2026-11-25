// Sidebar hint templates for the rotating tips section.
import { REOPEN_CLOSED_TAB_KEYBIND, type KeybindAction } from "../constants/keybinds.ts";

export type Hint = {
  title: string;
  text: string;
  shortcut?: string | { action: KeybindAction };
};

export const HINTS: readonly Hint[] = [
  {
    title: "Filter either pane",
    text: "Use the pane filter to narrow files by name, extension, or size.",
    shortcut: "Control+f",
  },
  {
    title: "Find large files",
    text: "In Indexed Search, try type:video >1GB to find large videos across indexed drives.",
    shortcut: { action: "openIndexedSearch" },
  },
  {
    title: "Quick Move",
    text: "With indexing on, select files, find a destination in Quick Move, and press Enter to move them.",
    shortcut: { action: "quickMove" },
  },
  {
    title: "Reopen a closed tab",
    text: "Restore the last tab you closed in the pane that has focus.",
    shortcut: REOPEN_CLOSED_TAB_KEYBIND,
  },
  {
    title: "Jump through tab history",
    text: "Right-click Back or Forward to pick a folder from this tab’s history.",
  },
  {
    title: "Drop a folder into a new tab",
    text: "Drag a folder, sidebar place, or drive onto the tab bar to open it in a new tab.",
  },
  {
    title: "Browse two folders together",
    text: "Use Link pane navigation in the lower pane to follow matching subfolders in both panes.",
  },
  {
    title: "Save a workspace",
    text: "Save the current tabs, pinned places, and pane layout so you can switch back later.",
  },
  {
    title: "Back up your setup",
    text: "Use Backup in Settings to export your settings, workspaces, and current session to one file.",
  },
  {
    title: "Preview a batch rename",
    text: "Select several files and use Rename to preview numbering, replacements, or prefixes.",
    shortcut: { action: "renameSelection" },
  },
  {
    title: "Preview selected media",
    text: "Select several media files and choose Open selected in gallery to browse just that selection.",
  },
  {
    title: "Play audio in Gallery",
    text: "Turn on Audio in gallery under Settings → Media to preview supported audio files.",
  },
  {
    title: "Copy paths or names",
    text: "Use Copy as text on selected items to copy a list of full paths or file names.",
  },
  {
    title: "Group files into a folder",
    text: "Use New folder with selection to move selected items into a new folder in one step.",
  },
  {
    title: "Reuse move destinations",
    text: "Turn on Remember move destinations in Settings → Context menus to reuse folders from Move to.",
  },
];

let sessionIndex = Math.floor(Math.random() * HINTS.length);

export const getSessionHint = () => HINTS[sessionIndex];

export const refreshSessionHint = () => {
  sessionIndex = (sessionIndex + 1) % HINTS.length;
  return getSessionHint();
};
