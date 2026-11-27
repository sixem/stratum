// Describe the action performed by the existing remote drop routes.
import type { DropTarget } from "../../lib/dropTarget.ts";

export function remoteDragAction(
  target: DropTarget | null,
  modifiers: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
): "copy" | "move" | "unavailable" {
  if (!target || target.kind === "tab-submenu" || modifiers.altKey) return "unavailable";
  if (target.kind === "remote-tab") return modifiers.ctrlKey ? "copy" : "move";
  if (target.kind === "tab" || target.kind === "tab-destination") return modifiers.shiftKey ? "move" : "copy";
  if (target.kind === "remote-pane" || target.kind === "remote-entry" || target.kind === "remote-crumb") return modifiers.ctrlKey ? "copy" : "move";
  return modifiers.shiftKey ? "move" : "copy";
}
