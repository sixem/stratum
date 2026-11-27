// One progress dialog owns each explicitly requested remote file open.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { formatBytes } from "@/lib/format";
import { usePromptStore, type PromptConfig } from "@/modules/promptStore";
import { useSettingsStore } from "@/modules/settings.store";
import "./remoteOpen.scss";

type Progress = { id: string; state: "downloading" | "opening" | "done" | "failed" | "cancelled"; done: number; total: number; error?: string };

function ProgressContent({ progress }: { progress: { subscribe: (listener: (value: Progress) => void) => () => void } }) {
  const [value, setValue] = useState<Progress>();
  useEffect(() => progress.subscribe(setValue), [progress]);
  if (value?.state === "failed") return <span role="alert">{value.error || "Could not open the file."}</span>;
  const label = !value ? "Preparing download…" : value.state === "opening" ? "Opening in default app…" : "Downloading";
  const percent = value && (value.total ? Math.min(100, Math.round(100 * value.done / value.total)) : 100);
  const size = value && `${formatBytes(value.done)} / ${formatBytes(value.total)}`;
  return <div className="remote-open-progress">
    <div className="remote-open-status">
      <span role="status">{label}</span>
      {size && <span className="tnum">{size}</span>}
    </div>
    <div className="remote-open-track" role="progressbar" aria-label="Download progress"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={size}>
      <span style={percent === undefined ? undefined : { width: `${percent}%` }} />
    </div>
  </div>;
}

export function openRemoteFile(profileId: string, sessionId: number, path: string, preview?: () => void) {
  const title = path.split("/").pop() || "Remote file";
  const start = () => downloadAndOpen(profileId, sessionId, path, title, preview);
  if (!useSettingsStore.getState().confirmRemoteOpen) { start(); return; }
  usePromptStore.getState().showPrompt({
    title, content: "Download a copy and open it in your default app?", footerNote: "Edits stay local.",
    confirmLabel: "Download & open", cancelLabel: "Cancel", onConfirm: start,
    actions: preview ? [{ label: "Preview", variant: "ghost", onClick: preview }] : undefined,
    aboveOverlays: true, queued: true,
  });
}

function downloadAndOpen(profileId: string, sessionId: number, path: string, title: string, preview?: () => void) {
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
    title,
    footerNote: "Edits stay local.",
    content: <ProgressContent progress={progress} />,
    confirmLabel: null,
    cancelLabel: "Cancel",
    onCancel: cancel,
    queued: true,
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
