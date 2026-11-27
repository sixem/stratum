// Saved hosts survive restart. Connections, errors, and in-flight operations belong to this app session.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { toMessage } from "@/lib/fsUtils";
import { loadRemoteProfiles, writeRemoteProfiles, type RemoteProfile } from "./remoteProfiles";
import { remoteDirectoryChanged, watchRemoteDirectoryChanges } from "./remoteDirectoryChanges";
import { usePromptStore } from "./promptStore";
import { remoteParent } from "@/lib/remotePaths";

export type { RemoteProfile } from "./remoteProfiles";
export type RemoteConnection = {
  status: "connecting" | "connected" | "disconnected";
  epoch: number;
  path?: string;
  sessionId?: number;
  error?: string;
};
type Connected = { path: string; sessionId: number };
type Disconnected = { profileId: string; sessionId: number };

export const useRemoteHosts = create<{
  profiles: RemoteProfile[];
  connections: Record<string, RemoteConnection | undefined>;
}>(() => ({ profiles: loadRemoteProfiles(), connections: {} }));

const connecting = new Map<string, Promise<string>>();
const exitedWhileConnecting = new Map<string, number>();
const disconnecting = new Map<string, Promise<void>>();
let listening: Promise<() => void> | undefined;

function connection(id: string) { return useRemoteHosts.getState().connections[id]; }
function publish(id: string, state: RemoteConnection) {
  useRemoteHosts.setState(current => ({ connections: { ...current.connections, [id]: state } }));
}

export function reportRemoteDisconnect(id: string, epoch: number, error?: string) {
  const current = connection(id);
  if (current?.epoch === epoch && current.status !== "disconnected") {
    publish(id, { status: "disconnected", epoch: epoch + 1, error });
  }
}

function watchConnections() {
  listening ??= listen<Disconnected>("remote-disconnected", ({ payload }) => {
    const current = connection(payload.profileId);
    if (current?.status === "connecting") {
      exitedWhileConnecting.set(payload.profileId, payload.sessionId);
    } else if (current && current.sessionId === payload.sessionId) {
      reportRemoteDisconnect(payload.profileId, current.epoch);
    }
  }).catch(error => {
    listening = undefined;
    throw error;
  });
  return listening;
}

export function connectRemote(profile: RemoteProfile): Promise<string> {
  const { id, destination, startPath } = profile;
  const closing = disconnecting.get(id);
  if (closing) return closing.then(() => connectRemote(profile));
  const pending = connecting.get(id);
  if (pending) return pending;
  const existing = connection(id);
  if (existing?.status === "connected" && existing.path) return Promise.resolve(existing.path);
  const epoch = (existing?.epoch ?? 0) + 1;
  // Place the request in the map before publishing. Subscribers may also request this host.
  const request = Promise.resolve().then(async () => {
    await Promise.all([watchConnections(), watchRemoteDirectoryChanges()]);
    // The user may have cancelled while the event listener was starting.
    if (connection(id)?.epoch !== epoch) throw new Error("Connection closed.");
    const result = await invoke<Connected>("remote_connect", { profileId: id, host: destination, startPath });
    if (connection(id)?.epoch !== epoch || exitedWhileConnecting.get(id) === result.sessionId) {
      throw new Error("Connection closed.");
    }
    publish(id, { status: "connected", epoch, ...result });
    void invoke<{ restored: string[]; warnings: string[] }>("remote_finish_interrupted_transfers", { profileId: id, sessionId: result.sessionId })
      .then(({ restored, warnings }) => {
        for (const path of restored) remoteDirectoryChanged({ profileId: id, sessionId: result.sessionId, path: remoteParent(path) });
        if (warnings.length) usePromptStore.getState().showPrompt({ title: "Interrupted transfer", content: warnings.join("\n\n"), confirmLabel: "OK", cancelLabel: null });
      }).catch(error => usePromptStore.getState().showPrompt({ title: "Interrupted transfer", content: toMessage(error, "Could not check interrupted transfers."), confirmLabel: "OK", cancelLabel: null }));
    return result.path;
  }).catch(error => {
    reportRemoteDisconnect(id, epoch, toMessage(error, "Could not connect to this host."));
    throw error;
  }).finally(() => {
    connecting.delete(id);
    exitedWhileConnecting.delete(id);
  });
  connecting.set(id, request);
  publish(id, { status: "connecting", epoch });
  return request;
}

export function disconnectRemote(id: string): Promise<void> {
  const existing = disconnecting.get(id);
  if (existing) return existing;
  const active = connection(id);
  if (!active || active.status === "disconnected") return Promise.resolve();
  const pending = connecting.get(id);
  const request = Promise.resolve().then(async () => {
    // Interrupt an active SSH handshake immediately. A second disconnect after
    // the pending request settles also covers cancellation during native startup.
    await invoke("remote_disconnect", { profileId: id });
    if (pending) {
      await pending.catch(() => {});
      await invoke("remote_disconnect", { profileId: id });
    }
  }).finally(() => disconnecting.delete(id));
  disconnecting.set(id, request);
  publish(id, { status: "disconnected", epoch: active.epoch + 1 });
  return request;
}

function persist(profiles: RemoteProfile[]) {
  writeRemoteProfiles(profiles);
  useRemoteHosts.setState({ profiles });
}

export async function verifyRemote(profile: RemoteProfile) {
  const probe = crypto.randomUUID();
  try {
    await invoke("remote_connect", { profileId: probe, host: profile.destination, startPath: profile.startPath });
  } finally {
    await invoke("remote_disconnect", { profileId: probe });
  }
}

export async function saveRemote(profile: RemoteProfile) {
  const previous = useRemoteHosts.getState().profiles.find(item => item.id === profile.id);
  if (useRemoteHosts.getState().profiles.some(item => item.id !== profile.id && item.destination === profile.destination)) {
    throw new Error("This SSH destination is already saved.");
  }
  if (previous && (previous.destination !== profile.destination || previous.startPath !== profile.startPath)) {
    await disconnectRemote(profile.id);
  }
  const current = useRemoteHosts.getState().profiles;
  if (current.some(item => item.id !== profile.id && item.destination === profile.destination)) {
    throw new Error("This SSH destination is already saved.");
  }
  persist(previous ? current.map(item => item.id === profile.id ? profile : item) : [...current, profile]);
}

export async function removeRemoteProfile(id: string) {
  await disconnectRemote(id);
  persist(useRemoteHosts.getState().profiles.filter(profile => profile.id !== id));
}
