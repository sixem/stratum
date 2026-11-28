// Work reads unresolved deliveries from Rust. Coalesce notifications during a batch of failures.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { toMessage } from "@/lib/fsUtils";

export type WebhookFailure = { id: number; name: string; origin: string; kind: string; eventId: string;
  error: string; attempts: number; canRetry: boolean };
type Work = { failures: WebhookFailure[]; total: number; missed: number; error: string | null };
export const useWebhookWork = create<Work>(() => ({ failures: [], total: 0, missed: 0, error: null }));
let version = 0;
export async function refreshWebhookWork() {
  const request = ++version;
  try {
    const work = await invoke<Work>("webhook_work");
    if (request === version) useWebhookWork.setState(work);
  } catch (error) {
    if (request === version) useWebhookWork.setState({ error: toMessage(error, "Could not read webhook deliveries.") });
  }
}

export function watchWebhookWork() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = listen("webhook-work-changed", () => {
    if (closed || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; void refreshWebhookWork(); }, 100);
  });
  void stop.then(() => { if (!closed) void refreshWebhookWork(); }).catch(() => {
    if (!closed) useWebhookWork.setState({ error: "Could not subscribe to webhook delivery updates." });
  });
  return () => { closed = true; clearTimeout(timer); void stop.then(unlisten => unlisten()).catch(() => {}); };
}
