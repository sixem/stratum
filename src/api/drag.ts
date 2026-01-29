// Starts native drag sessions for selected paths.
import { invoke } from "@tauri-apps/api/core";

export type DragOutcome = "copy" | "move" | "none";

export const startDrag = (paths: string[]) =>
  invoke<DragOutcome>("start_drag", { paths });
