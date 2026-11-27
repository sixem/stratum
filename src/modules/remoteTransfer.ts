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
type BatchResult = { items: { index: number; result: CopyResult | null; error: string | null }[]; cancelled: boolean };
type RemoteSelection = { name: string; isDir: boolean; isSymlink?: boolean; size: number | null; modified: number | null };
const RECOVERY_CANCELLED_PREFIX = "Transfer cancelled; recovery required: ";
let promptTail: Promise<unknown> = Promise.resolve();

// Conflict and completion prompts from separate drops must not replace each other.
function queuedPrompt<T>(show: () => Promise<T>): Promise<T> {
  const next = promptTail.then(show);
  promptTail = next.catch(() => {});
  return next;
}

function confirmReplacement(paths: string[], destination: string): Promise<"replace" | "skip" | "cancel"> {
  return queuedPrompt(() => new Promise(resolve => {
    const names = paths.slice(0, 4).join("\n") + (paths.length > 4 ? `\n…and ${paths.length - 4} more` : "");
    usePromptStore.getState().showPrompt({
      title: "Items already exist",
      content: `Replace items in ${destination}? Folders are replaced as a whole. Existing items will be kept as backups in the destination.\n\n${names}`,
      confirmLabel: "Replace", cancelLabel: "Cancel",
      actions: [{ label: "Skip existing", variant: "ghost", onClick: () => resolve("skip") }],
      onConfirm: () => resolve("replace"), onCancel: () => resolve("cancel"),
    });
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
) {
  const candidates: { path: string; request: Request; conflict: boolean }[] = [];
  const failures: string[] = [];
  for (const path of paths) {
    const request: Request = remoteTarget
      ? { kind: "remote", remotePath: path, destProfile: remoteTarget.profileId, destSession: remoteTarget.sessionId, remoteFolder: remoteTarget.path }
      : direction === "upload"
      ? { kind: "upload", localPath: path, remoteFolder: remote.path }
      : { kind: "download", remotePath: path, localFolder };
    try {
      const conflict = await invoke<boolean>("remote_transfer_conflict", { profileId: remote.profileId, sessionId: remote.sessionId, request });
      candidates.push({ path, request, conflict });
    } catch (error) {
      failures.push(`${path}: ${getTransferErrorMessage(error, "Could not check the destination.")}`);
    }
  }
  const conflicts = candidates.filter(item => item.conflict);
  if (moving) failures.push(...conflicts.map(item => `${item.path}: An item with this name already exists in the destination.`));
  const decision = conflicts.length && !moving ? await confirmReplacement(conflicts.map(item => item.path), remoteTarget?.path ?? (direction === "upload" ? remote.path : localFolder)) : moving ? "skip" : "replace";
  if (decision === "cancel") { await reportResults(failures, []); return; }
  const ready = candidates.filter(item => !item.conflict || decision === "replace");
  if (ready.length > 0 && paths.length > 1) {
    const preflightFailures = failures.length;
    const store = useTransferStore.getState();
    const label = moving ? "Move" : remoteTarget ? "Copy" : direction === "upload" ? "Upload" : "Download";
    const fileJob = direction === "upload" ? store.registerFileJob({ label, items: ready.map(item => item.path), kind: "transfer" }) : undefined;
    const registration = fileJob ?? store.registerJob({ label, items: ready.map(item => item.path) });
    const backups: string[] = [], warnings: string[] = [];
    let unlisten: (() => void) | undefined;
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
      const item = ready[index];
      if (item) {
        if (fileJob) {
          settled.add(item.path);
          settleTimer ??= window.setTimeout(flushSettled, 100);
        }
        refreshRemoteTransferViews({ sourcePath: item.path, remote, localFolder, direction, moving, remoteTarget });
      }
    };
    try {
      unlisten = await listen<{ transferId: string; index: number }>("remote-transfer-batch-item", event => {
        if (event.payload.transferId === registration.id) refresh(event.payload.index);
      }).catch(() => undefined);
      const items = ready.map(({ path, request, conflict }) => {
        const selected = sourceEntries?.get(path);
        const expected = selected && { name: selected.name, isDir: selected.isDir, isSymlink: Boolean(selected.isSymlink), size: selected.size, modified: selected.modified };
        return { request, replace: conflict, expected };
      });
      const report = await invoke<BatchResult>("remote_transfer_batch", { profileId: remote.profileId, sessionId: remote.sessionId, items, transferId: registration.id, moving, preflightFailures });
      let copied = 0, moved = 0, failed = 0;
      for (const item of report.items) {
        const path = ready[item.index]?.path ?? "Item";
        if (item.result) {
          if (moving && !item.result.warning) moved++; else copied++;
          if (item.result.backup) backups.push(item.result.backup);
          if (item.result.warning) warnings.push(item.result.warning);
        } else if (item.error && !isTransferCancelledError(item.error)) {
          if (item.error.startsWith(RECOVERY_CANCELLED_PREFIX)) warnings.push(`Move cancelled. Reconnect to restore the original. It may be at ${item.error.slice(RECOVERY_CANCELLED_PREFIX.length)}.`);
          else { failures.push(`${path}: ${item.error}`); failed++; }
        }
      }
      useTransferStore.getState().recordJobOutcome(registration.id, { copied, moved, failures: failed + preflightFailures });
    } catch (error) {
      if (!isTransferCancelledError(error)) {
        failures.push(getTransferErrorMessage(error, moving ? "Could not move the items." : "Could not copy the items."));
        useTransferStore.getState().recordJobOutcome(registration.id, { failures: 1 });
      }
    } finally {
      unlisten?.(); ready.forEach((_, index) => refresh(index));
      flushSettled(); fileJob?.finish();
    }
    await reportResults(failures, backups, warnings, moving);
    return;
  }
  const outcomes = await Promise.all(ready.map(async ({ path, request, conflict }) => {
    const store = useTransferStore.getState();
    const label = moving ? "Move" : remoteTarget ? "Copy" : direction === "upload" ? "Upload" : "Download";
    const fileJob = direction === "upload" ? store.registerFileJob({ label, items: [path], kind: "transfer" }) : undefined;
    const registration = fileJob ?? store.registerJob({ label, items: [path] });
    try {
      const selected = sourceEntries?.get(path);
      const expected = selected && { name: selected.name, isDir: selected.isDir, isSymlink: Boolean(selected.isSymlink), size: selected.size, modified: selected.modified };
      const result = await invoke<CopyResult>("remote_transfer_file", { profileId: remote.profileId, sessionId: remote.sessionId, request, transferId: registration.id, replace: conflict, moving, expected });
      const moved = moving && !result.warning;
      useTransferStore.getState().recordJobOutcome(registration.id, moved ? { moved: 1 } : { copied: 1 });
      return { backup: result.backup ?? undefined, warning: result.warning ?? undefined };
    } catch (error) {
      if (isTransferCancelledError(error)) return {};
      const message = getTransferErrorMessage(error, moving ? "Could not move the file." : "Could not copy the file.");
      if (moving && message.startsWith(RECOVERY_CANCELLED_PREFIX)) return { warning: `Move cancelled. Reconnect to restore the original. It may be at ${message.slice(RECOVERY_CANCELLED_PREFIX.length)}.` };
      useTransferStore.getState().recordJobOutcome(registration.id, { failures: 1 });
      return { error: `${path}: ${message}` };
    } finally {
      fileJob?.finish();
      refreshRemoteTransferViews({ sourcePath: path, remote, localFolder, direction, moving, remoteTarget });
    }
  }));
  failures.push(...outcomes.flatMap(outcome => outcome.error ? [outcome.error] : []));
  const backups = outcomes.flatMap(outcome => outcome.backup ? [outcome.backup] : []);
  const warnings = outcomes.flatMap(outcome => outcome.warning ? [outcome.warning] : []);
  await reportResults(failures, backups, warnings, moving);
}
