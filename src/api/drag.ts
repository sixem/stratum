// Starts native drag sessions for selected paths.
import { invoke } from "@tauri-apps/api/core";

export type DragOutcome = "copy" | "move" | "none";

export function startDrag(paths: string[]) {
  return invoke<DragOutcome>("start_drag", { paths });
}
