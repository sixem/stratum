// Physical coordinates come from the Windows drop target. Transfer mode belongs
// to the drop event so releasing a modifier after the mouse has no effect.
import type { TransferMode } from "@/types";

type PositionedDrag = { position: { x: number; y: number }; canOpenFolderTab?: boolean };

export type NativeFileDrag =
  | (PositionedDrag & { type: "enter" | "over" })
  | { type: "leave" }
  | { type: "error"; message: string }
  | (PositionedDrag & { type: "drop"; paths: string[]; mode: TransferMode; stage: number | null });

// Conflict prompts run in release order. The backend schedules the transfers.
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
