// A drop owns its Work row while waiting for SSH, then hands its ID to the transfer queue.
import { reportRemotePreflightEnd } from "./remoteTransfer";
import { connectRemote, useRemoteHosts } from "./remoteHosts";
import { getPaneSessionStore } from "./sessionStore";
import { useTransferStore } from "./transferStore";
import type { DropTarget } from "@/lib/dropTarget";

export async function prepareRemoteTabDrop(target: Pick<DropTarget, "tabId" | "profileId" | "sessionId" | "tabPath"> & { path: string }, paths: string[], moving: boolean) {
  const profile = useRemoteHosts.getState().profiles.find(item => item.id === target.profileId);
  if (!profile) throw new Error("The destination host is no longer available.");
  if (target.sessionId !== undefined && useRemoteHosts.getState().connections[profile.id]?.sessionId !== target.sessionId) {
    throw new Error("The destination session changed. Drop the files again.");
  }
  const controller = new AbortController();
  const store = useTransferStore.getState();
  const preflight = useRemoteHosts.getState().connections[profile.id]?.status !== "connected"
    ? store.startJob({ label: `Connecting to ${profile.name}`, items: paths, total: paths.length, kind: moving ? "move" : "copy",
      cancelPreflight: () => controller.abort() }) : undefined;
  try {
    await connectRemote(profile, controller.signal);
    controller.signal.throwIfAborted();
    const sessionId = useRemoteHosts.getState().connections[profile.id]?.sessionId;
    if (!sessionId) throw new Error("The destination host is disconnected.");
    const tab = (["main", "bottom"] as const).flatMap(pane => getPaneSessionStore(pane).getState().tabs).find(item => item.id === target.tabId);
    if (tab?.kind !== "remote" || tab.remote.hostId !== profile.id || tab.remote.path !== (target.tabPath ?? target.path)
        || (target.sessionId !== undefined && target.sessionId !== sessionId)) {
      throw new Error("The destination tab changed. Drop the files again.");
    }
    if (preflight) store.finishPreflight(preflight.id, "ready");
    return { profileId: profile.id, sessionId, path: target.path, transferId: preflight?.id };
  } catch (error) {
    if (preflight) {
      store.finishPreflight(preflight.id, controller.signal.aborted ? "cancelled" : "failed");
      reportRemotePreflightEnd(preflight.id, controller.signal.aborted);
    }
    if (!controller.signal.aborted) throw error;
  }
}
