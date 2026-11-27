// Notify every open view of a changed remote directory on the same session.
import { listen } from "@tauri-apps/api/event";
type Change = { profileId: string; sessionId: number; path: string };
const eventName = "stratum-remote-directory-changed";
let watching: Promise<() => void> | undefined;
const pending = new Map<string, number>();

export function watchRemoteDirectoryChanges() {
  watching ??= listen<Change>("remote-directory-changed", ({ payload }) => {
    const key = JSON.stringify([payload.profileId, payload.sessionId, payload.path]);
    if (pending.has(key)) return;
    pending.set(key, window.setTimeout(() => { pending.delete(key); remoteDirectoryChanged(payload); }, 100));
  }).catch(error => { watching = undefined; throw error; });
  return watching;
}

export function remoteDirectoryChanged(change: Change) {
  window.dispatchEvent(new CustomEvent<Change>(eventName, { detail: change }));
}

export function listenRemoteDirectoryChanges(callback: (change: Change) => void) {
  const onChange = (event: Event) => callback((event as CustomEvent<Change>).detail);
  window.addEventListener(eventName, onChange);
  return () => window.removeEventListener(eventName, onChange);
}
