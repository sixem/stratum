// Keybind definitions and keyboard parsing primitives.

export type KeybindAction =
  | "newTab"
  | "closeTab"
  | "undo"
  | "deleteSelection"
  | "duplicateSelection"
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
export const RESERVED_KEYBIND_DEFINITIONS = [
  { combo: "Control+f", label: "Search" },
  { combo: "Control+a", label: "Select all" },
  { combo: "Control+c", label: "Copy" },
  { combo: "Control+v", label: "Paste" },
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
