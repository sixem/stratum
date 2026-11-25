// Keybind definitions and keyboard parsing primitives.

export type KeybindAction =
  | "newTab"
  | "closeTab"
  | "openIndexedSearch"
  | "quickMove"
  | "undo"
  | "deleteSelection"
  | "renameSelection"
  | "duplicateSelection"
  | "copyToOtherPane"
  | "moveToOtherPane"
  | "selectSameExtension"
  | "invertSelection"
  | "focusOtherPane"
  | "focusSplitTerminal"
  | "previewItem"
  | "prevTab"
  | "nextTab";

export type KeybindMap = Record<KeybindAction, string>;

export type KeybindDefinition = {
  id: KeybindAction;
  label: string;
  description: string;
  default: string;
};

export const KEYBIND_DEFINITIONS: KeybindDefinition[] = [
  {
    id: "newTab",
    label: "New tab",
    description: "Open a fresh tab.",
    default: "Control+t",
  },
  {
    id: "closeTab",
    label: "Close tab",
    description: "Close the current tab.",
    default: "Control+w",
  },
  {
    id: "openIndexedSearch",
    label: "Indexed search",
    description: "Open the indexed path search modal.",
    default: "Control+p",
  },
  {
    id: "undo",
    label: "Undo",
    description: "Undo the last file operation.",
    default: "Control+z",
  },
  {
    id: "deleteSelection",
    label: "Delete selection",
    description: "Delete the selected files and folders.",
    default: "Delete",
  },
  {
    id: "renameSelection",
    label: "Rename selection",
    description: "Rename one item inline or open Batch Rename for multiple items.",
    default: "F2",
  },
  {
    id: "duplicateSelection",
    label: "Duplicate selection",
    description: "Make a copy in the current folder.",
    default: "Control+d",
  },
  {
    id: "previewItem",
    label: "Preview item",
    description: "Preview the hovered item (hold to peek).",
    default: "MouseMiddle",
  },
  {
    id: "prevTab",
    label: "Previous tab",
    description: "Switch to the tab on the left.",
    default: "Control+ArrowLeft",
  },
  {
    id: "nextTab",
    label: "Next tab",
    description: "Switch to the tab on the right.",
    default: "Control+ArrowRight",
  },
  {
    id: "quickMove",
    label: "Quick Move",
    description: "Find a destination for the selected items.",
    default: "Control+Shift+m",
  },
  {
    id: "copyToOtherPane",
    label: "Copy to other pane",
    description: "Copy the selected items to the folder open in the other pane.",
    default: "",
  },
  {
    id: "moveToOtherPane",
    label: "Move to other pane",
    description: "Move the selected items to the folder open in the other pane.",
    default: "",
  },
  {
    id: "selectSameExtension",
    label: "Select same extension",
    description: "Select visible files with the same extension as the selected file.",
    default: "",
  },
  {
    id: "invertSelection",
    label: "Invert selection",
    description: "Invert the selection among visible items in the focused pane.",
    default: "",
  },
  {
    id: "focusOtherPane",
    label: "Focus other pane",
    description: "Move keyboard focus to the other pane when it is open.",
    default: "",
  },
  {
    id: "focusSplitTerminal",
    label: "Switch focus between folder and PowerShell",
    description: "Move keyboard focus between the folder and terminal in the active split tab.",
    default: "",
  },
];

export const DEFAULT_KEYBINDS = KEYBIND_DEFINITIONS.reduce<KeybindMap>((acc, entry) => {
  acc[entry.id] = entry.default;
  return acc;
}, {} as KeybindMap);

export const MODIFIER_ORDER = ["Control", "Alt", "Shift", "Meta"] as const;
export const MODIFIER_KEYS = new Set(MODIFIER_ORDER);
export const PRIMARY_MODIFIERS = new Set(["Control", "Alt", "Meta"]);
export const SINGLE_CHAR_PATTERN = /^.$/;

// Fixed shortcuts that cannot be reassigned.
export const REOPEN_CLOSED_TAB_KEYBIND = "Control+Shift+t";

export const RESERVED_KEYBIND_DEFINITIONS = [
  { combo: "Control+f", label: "Search" },
  { combo: "Control+a", label: "Select all" },
  { combo: "Control+c", label: "Copy" },
  { combo: "Control+x", label: "Cut" },
  { combo: "Control+v", label: "Paste" },
  { combo: "Control+l", label: "Edit path" },
  { combo: "Control+Tab", label: "Next pane tab" },
  { combo: "Control+Shift+Tab", label: "Previous pane tab" },
  { combo: REOPEN_CLOSED_TAB_KEYBIND, label: "Reopen closed tab" },
  { combo: "ContextMenu", label: "Context menu" },
  { combo: "Shift+F10", label: "Windows context menu" },
  { combo: "Escape", label: "Cancel" },
  { combo: "Control+r", label: "Refresh" },
  { combo: "F5", label: "Refresh" },
  { combo: "Control+1", label: "Tab 1" },
  { combo: "Control+2", label: "Tab 2" },
  { combo: "Control+3", label: "Tab 3" },
  { combo: "Control+4", label: "Tab 4" },
  { combo: "Control+5", label: "Tab 5" },
  { combo: "Control+6", label: "Tab 6" },
  { combo: "Control+7", label: "Tab 7" },
  { combo: "Control+8", label: "Tab 8" },
  { combo: "Control+9", label: "Tab 9" },
];

export const RESERVED_KEYBINDS = RESERVED_KEYBIND_DEFINITIONS.map(
  (definition) => definition.combo,
);
