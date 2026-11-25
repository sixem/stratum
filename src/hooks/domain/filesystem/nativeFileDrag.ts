// Physical coordinates come from the Windows drop target. Transfer mode belongs
// to the drop event so releasing a modifier after the mouse has no effect.
import type { TransferMode } from "@/types";

type PositionedDrag = { position: { x: number; y: number }; canOpenFolderTab?: boolean };

export type NativeFileDrag =
  | (PositionedDrag & { type: "enter" | "over" })
  | (PositionedDrag & { type: "receiving"; pendingDrop: number })
  | { type: "leave" }
  | { type: "error"; message: string; pendingDrop?: number | null }
  | (PositionedDrag & { type: "drop"; paths: string[]; mode: TransferMode; stage: number | null; pendingDrop?: number | null });

// Conflict prompts run one at a time. The backend schedules the transfers.
export class FileDropQueue {
  private tail = Promise.resolve();
  private pending = 0;

  get busy() { return this.pending > 0; }

  add<T>(run: () => T | Promise<T>) {
    this.pending++;
    const result = this.tail.then(run).finally(() => { this.pending--; });
    this.tail = result.then(() => {}, () => {});
    return result;
  }
}
