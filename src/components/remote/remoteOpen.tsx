// One progress dialog owns each explicitly requested remote file open.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { formatBytes } from "@/lib/format";
import { usePromptStore, type PromptConfig } from "@/modules/promptStore";

type Progress = { id: string; state: "downloading" | "opening" | "done" | "failed" | "cancelled"; done: number; total: number; error?: string };

function ProgressContent({ progress }: { progress: { subscribe: (listener: (value: Progress) => void) => () => void } }) {
  const [value, setValue] = useState<Progress>();
  useEffect(() => progress.subscribe(setValue), [progress]);
  if (!value) return <span>Connecting…</span>;
  if (value.state === "failed") return <span role="alert">{value.error || "Could not open the file."}</span>;
  if (value.state === "opening") return <span>Opening…</span>;
  return <div>
    <div>{formatBytes(value.done)} / {formatBytes(value.total)}</div>
    <progress max={value.total || 1} value={value.done} aria-label="Download progress" />
    <div>Changes will stay in the local copy.</div>
  </div>;
}

export function openRemoteFile(profileId: string, sessionId: number, path: string, preview?: () => void) {
  const id = crypto.randomUUID();
  let cancelled = false;
  let started = false;
  let current: Progress | undefined;
  let listener: ((value: Progress) => void) | undefined;
  const progress = {
    subscribe(callback: (value: Progress) => void) {
      listener = callback;
      if (current) callback(current);
      return () => { if (listener === callback) listener = undefined; };
    },
  };
  const cancel = () => {
    cancelled = true;
    if (started) void invoke("remote_cancel_open", { id }).catch(() => {});
  };
  const prompt: PromptConfig = {
    title: "Opening " + (path.split("/").pop() || "file"),
    content: <ProgressContent progress={progress} />,
    confirmLabel: null,
    cancelLabel: "Cancel",
    onCancel: cancel,
    aboveOverlays: true,
    actions: preview ? [{ label: "Preview", variant: "ghost", onClick: () => { cancel(); preview(); } }] : undefined,
  };
  usePromptStore.getState().showPrompt(prompt);
  void (async () => {
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<Progress>("remote-open-progress", event => {
        if (event.payload.id !== id) return;
        current = event.payload;
        listener?.(current);
        if (current.state === "done" || current.state === "cancelled") {
          usePromptStore.getState().hidePrompt(prompt);
        }
        if (current.state === "done" || current.state === "cancelled" || current.state === "failed") unlisten?.();
      });
      if (cancelled) { unlisten(); return; }
      await invoke("remote_start_open", { id, profileId, sessionId, path });
      started = true;
      if (cancelled) await invoke("remote_cancel_open", { id });
    } catch (error) {
      if (!cancelled) {
        current = { id, state: "failed", done: 0, total: 0, error: String(error) };
        listener?.(current);
      }
      unlisten?.();
    }
  })();
}
