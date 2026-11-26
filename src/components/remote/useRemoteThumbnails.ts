// Request previews only for visible, supported remote images.
import { useEffect, useRef, useState } from "react";
import { canPreviewRemote, type RemoteEntry } from "./remoteDirectory";
import { getRemoteThumbnail, requestRemoteThumbnail, remoteThumbnailGeneration, REMOTE_THUMBNAILS_CLEARED } from "./remoteThumbnailCache";

export function useRemoteThumbnails(profileId: string, sessionId: number, visible: RemoteEntry[], enabled: boolean) {
  const local = useRef(new Map<string, string | null>());
  const worker = useRef<Promise<void>>(Promise.resolve());
  const [, repaint] = useState(0);
  const [cacheRevision, setCacheRevision] = useState(0);
  useEffect(() => {
    const clear = () => { local.current.clear(); setCacheRevision(value => value + 1); };
    window.addEventListener(REMOTE_THUMBNAILS_CLEARED, clear);
    return () => window.removeEventListener(REMOTE_THUMBNAILS_CLEARED, clear);
  }, []);
  const keyFor = (entry: RemoteEntry) => JSON.stringify([entry.path, entry.size, entry.modified]);
  useEffect(() => {
    if (!enabled) {
      local.current.clear();
      return;
    }
    let current = true;
    const generation = remoteThumbnailGeneration();
    worker.current = worker.current.then(async () => {
      for (const entry of visible) {
        if (!current) return;
        if (!canPreviewRemote(entry)) continue;
        const key = keyFor(entry);
        if (local.current.has(key)) continue;
        const cached = getRemoteThumbnail(profileId, sessionId, entry);
        if (cached) continue;
        try {
          const image = await requestRemoteThumbnail(profileId, sessionId, entry);
          if (!current || generation !== remoteThumbnailGeneration()) return;
          local.current.set(key, image);
          if (local.current.size > 128) local.current.delete(local.current.keys().next().value!);
          if (image) repaint(n => n + 1);
        } catch {
          // Transport failures remain retryable after a reconnect or refresh.
        }
      }
    });
    return () => { current = false; };
  }, [enabled, profileId, sessionId, visible, cacheRevision]);
  return (entry: RemoteEntry) => enabled &&
    (getRemoteThumbnail(profileId, sessionId, entry) ?? local.current.get(keyFor(entry)));
}
