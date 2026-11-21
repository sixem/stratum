// Starts native drag sessions for selected paths.
import { invoke } from "@tauri-apps/api/core";

export type DragOutcome = "copy" | "move" | "link" | "none";

export const startDrag = (paths: string[], id: number, canOpenFolderTab: boolean) =>
  invoke<DragOutcome>("start_drag", { paths, id, canOpenFolderTab });

export const cancelDragStart = (id: number) => invoke<void>("cancel_drag_start", { id });
export const releaseDropStage = (id: number) => invoke<void>("release_drop_stage", { id });
export const fileDropListenerReady = () => invoke<void>("file_drop_listener_ready");
