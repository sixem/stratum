// Queue remote copies and moves using the same Work controls as local transfers.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTransferCancelledError, getTransferErrorMessage } from "@/hooks/domain/filesystem/transferJobErrors";
import { usePromptStore } from "@/modules/promptStore";
import { useTransferStore } from "@/modules/transferStore";
import { refreshRemoteTransferViews } from "@/modules/remoteTransferRefresh";

type RemoteDestination = { profileId: string; sessionId: number; path: string };
type Request = { kind: "upload"; localPath: string; remoteFolder: string } | { kind: "download"; remotePath: string; localFolder: string } |
  { kind: "remote"; remotePath: string; destProfile: string; destSession: number; remoteFolder: string };
type CopyResult = { path: string; backup?: string | null; warning?: string | null };
type BatchResult = { items: { index: number; result: CopyResult | null; error: string | null; skipped: boolean }[]; cancelled: boolean };
type RemoteSelection = { name: string; isDir: boolean; isSymlink?: boolean; size: number | null; modified: number | null };
const RECOVERY_CANCELLED_PREFIX = "Transfer cancelled; recovery required: ";
let promptTail: Promise<unknown> = Promise.resolve();

// Conflict and completion prompts from separate drops must not replace each other.
function queuedPrompt<T>(show: () => Promise<T>): Promise<T> {
  const next = promptTail.then(show);
  promptTail = next.catch(() => {});
  return next;
}

function confirmReplacement(paths: string[], destination: string, signal: AbortSignal): Promise<"replace" | "skip" | "cancel"> {
  return queuedPrompt(() => new Promise(resolve => {
    if (signal.aborted) { resolve("cancel"); return; }
    const names = paths.slice(0, 4).join("\n") + (paths.length > 4 ? `\n…and ${paths.length - 4} more` : "");
    const finish = (decision: "replace" | "skip" | "cancel") => {
      signal.removeEventListener("abort", abort);
      resolve(decision);
    };
    const abort = () => { usePromptStore.getState().hidePrompt(prompt); finish("cancel"); };
    const prompt = {
      title: "Items already exist",
      content: `Replace items in ${destination}? Folders are replaced as a whole. Existing items will be kept as backups in the destination.\n\n${names}`,
      confirmLabel: "Replace", cancelLabel: "Cancel",
      actions: [{ label: "Skip existing", variant: "ghost" as const, onClick: () => finish("skip") }],
      onConfirm: () => finish("replace"), onCancel: () => finish("cancel"),
    };
    signal.addEventListener("abort", abort, { once: true });
    usePromptStore.getState().showPrompt(prompt);
  }));
}

function reportResults(failures: string[], backups: string[], warnings: string[] = [], moving = false) {
  if (!failures.length && !backups.length && !warnings.length) return Promise.resolve();
  return queuedPrompt(() => new Promise<void>(resolve => {
    const message = [failures.length ? `Could not ${moving ? "move" : "copy"}:\n${failures.join("\n")}` : "",
      backups.length ? `Original items were kept at:\n${backups.join("\n")}` : "",
      warnings.join("\n")].filter(Boolean).join("\n\n");
    usePromptStore.getState().showPrompt({ title: failures.length ? `${moving ? "Move" : "Copy"} completed with issues` : moving && warnings.length ? "Move needs attention" : warnings.length ? "Copy completed with issues" : "Originals saved",
      content: message, confirmLabel: "OK", cancelLabel: null, onConfirm: resolve, onCancel: resolve });
  }));
}

export async function copyRemoteFiles(
  paths: string[],
  remote: RemoteDestination,
  localFolder: string,
  direction: "upload" | "download",
  moving = false,
  remoteTarget?: RemoteDestination,
  sourceEntries?: ReadonlyMap<string, RemoteSelection>,
  transferId?: string,
) {
  if (!paths.length) return;
  const candidates = paths.map((path): { path: string; request: Request } => ({ path, request: remoteTarget
    ? { kind: "remote", remotePath: path, destProfile: remoteTarget.profileId, destSession: remoteTarget.sessionId, remoteFolder: remoteTarget.path }
    : direction === "upload" ? { kind: "upload", localPath: path, remoteFolder: remote.path }
    : { kind: "download", remotePath: path, localFolder } }));
  const failures: string[] = [];
  const store = useTransferStore.getState();
  const label = moving ? "Move" : remoteTarget ? "Copy" : direction === "upload" ? "Upload" : "Download";
  const fileJob = direction === "upload" ? store.registerFileJob({ id: transferId, label, items: paths, kind: "transfer" }) : undefined;
  const registration = fileJob ?? store.registerJob({ id: transferId, label, items: paths });
  const backups: string[] = [], warnings: string[] = [];
  const unlisteners: (() => void)[] = [];
  const promptLifetime = new AbortController();
  const settled = new Set<string>();
  let settleTimer: number | undefined;
  const flushSettled = () => {
    if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    settleTimer = undefined;
    if (!settled.size) return;
    useTransferStore.getState().settleFilePaths(new Map([[registration.id, new Set(settled)]]));
    settled.clear();
  };
  const refresh = (index: number) => {
    const item = candidates[index];
    if (item) {
      if (fileJob) {
        settled.add(item.path);
        settleTimer ??= window.setTimeout(flushSettled, 100);
      }
      refreshRemoteTransferViews({ sourcePath: item.path, remote, localFolder, direction, moving, remoteTarget });
    }
  };
  try {
    unlisteners.push(await listen<{ transferId: string; index: number }>("remote-transfer-batch-item", event => {
      if (event.payload.transferId === registration.id) refresh(event.payload.index);
    }));
    unlisteners.push(await listen<{ transferId: string; indices: number[] }>("remote-transfer-conflicts", event => {
      if (event.payload.transferId !== registration.id) return;
      const conflictingPaths = event.payload.indices.map(index => candidates[index]?.path).filter((path): path is string => Boolean(path));
      void confirmReplacement(conflictingPaths, remoteTarget?.path ?? (direction === "upload" ? remote.path : localFolder), promptLifetime.signal)
        .then(decision => promptLifetime.signal.aborted ? undefined : invoke("remote_transfer_conflict_decision", { transferId: registration.id, decision }))
        .catch(() => { void invoke("cancel_transfer_job", { jobId: registration.id }).catch(() => {}); });
    }));
    const items = candidates.map(({ path, request }) => {
      const selected = sourceEntries?.get(path);
      const expected = selected && { name: selected.name, isDir: selected.isDir, isSymlink: Boolean(selected.isSymlink), size: selected.size, modified: selected.modified };
      return { request, expected };
    });
    const report = await invoke<BatchResult>("remote_transfer_batch", { profileId: remote.profileId, sessionId: remote.sessionId, items, transferId: registration.id, moving });
    let copied = 0, moved = 0, failed = 0, skipped = 0;
    for (const item of report.items) {
      const path = candidates[item.index]?.path ?? "Item";
      if (item.result) {
        if (moving && !item.result.warning) moved++; else copied++;
        if (item.result.backup) backups.push(item.result.backup);
        if (item.result.warning) warnings.push(item.result.warning);
      } else if (item.skipped) skipped++;
      else if (item.error && !isTransferCancelledError(item.error)) {
        if (item.error.startsWith(RECOVERY_CANCELLED_PREFIX)) warnings.push(`Move cancelled. Reconnect to restore the original. It may be at ${item.error.slice(RECOVERY_CANCELLED_PREFIX.length)}.`);
        else { failures.push(`${path}: ${item.error}`); failed++; }
      }
    }
    useTransferStore.getState().recordJobOutcome(registration.id, { copied, moved, skipped, failures: failed });
  } catch (error) {
    if (transferId) store.failJob(transferId);
    if (!isTransferCancelledError(error)) {
      failures.push(getTransferErrorMessage(error, moving ? "Could not move the items." : "Could not copy the items."));
      useTransferStore.getState().recordJobOutcome(registration.id, { failures: 1 });
    }
  } finally {
    promptLifetime.abort(); unlisteners.forEach(unlisten => unlisten()); candidates.forEach((_, index) => refresh(index));
    flushSettled(); fileJob?.finish();
  }
  await reportResults(failures, backups, warnings, moving);
}
