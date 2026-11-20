// Physical coordinates come from the Windows drop target. Transfer mode belongs
// to the drop event so releasing a modifier after the mouse has no effect.
import type { TransferMode } from "@/types";

export type NativeFileDrag =
  | { type: "enter" | "over"; position: { x: number; y: number } }
  | { type: "leave" }
  | { type: "error"; message: string }
  | { type: "drop"; position: { x: number; y: number }; paths: string[]; mode: TransferMode; stage: number | null };

// Prompts and transfers run in release order. A rejection leaves the queue usable.
export class FileDropQueue {
  private tail = Promise.resolve();
  private pending = 0;

  get busy() { return this.pending > 0; }

  add(run: () => Promise<void>) {
    this.pending++;
    const result = this.tail.then(run).finally(() => { this.pending--; });
    this.tail = result.catch(() => {});
    return result;
  }
}
