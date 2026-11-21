// Add the same native shell menu affordance to each context-menu surface.
import type { ContextMenuItem } from "@/types";

export const appendWindowsMenuItem = (items: ContextMenuItem[], onSelect: () => void): ContextMenuItem[] => [
  ...items,
  { kind: "divider", id: "windows-menu-divider" },
  { id: "windows-menu", label: "Show more options", hint: "Shift+F10", icon: "more-options", onSelect },
];
