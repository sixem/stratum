// IPC for reserving and draining the native job queue before closing.
import { invoke } from "@tauri-apps/api/core";

export type TransferShutdownMode = "idleOnly" | "wait" | "cancel";

export const beginTransferShutdown = (mode: TransferShutdownMode) =>
  invoke<number | null>("begin_transfer_shutdown", { mode });

export const waitForTransferShutdown = (ticket: number) =>
  invoke<boolean>("wait_for_transfer_shutdown", { ticket });

export const reopenTransferQueue = (ticket: number) =>
  invoke<boolean>("reopen_transfer_queue", { ticket });
