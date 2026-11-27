// Request previews only for visible, supported remote images.
import { useEffect, useRef, useState } from "react";
import { canPreviewRemote, canPreviewRemoteVideo, type RemoteEntry } from "./remoteDirectory";
import { getRemoteThumbnail, requestRemoteThumbnail, remoteThumbnailGeneration, REMOTE_THUMBNAILS_CLEARED, REMOTE_THUMBNAIL_UPDATED } from "./remoteThumbnailCache";

export function useRemoteThumbnails(profileId: string, sessionId: number, visible: RemoteEntry[], enabled: boolean, videosEnabled = false) {
  const local = useRef(new Map<string, string | null>());
  const worker = useRef<Promise<void>>(Promise.resolve());
  const [, repaint] = useState(0);
  const [cacheRevision, setCacheRevision] = useState(0);
  useEffect(() => {
    const clear = () => { local.current.clear(); setCacheRevision(value => value + 1); };
    window.addEventListener(REMOTE_THUMBNAILS_CLEARED, clear);
    window.addEventListener(REMOTE_THUMBNAIL_UPDATED, clear);
    return () => { window.removeEventListener(REMOTE_THUMBNAILS_CLEARED, clear); window.removeEventListener(REMOTE_THUMBNAIL_UPDATED, clear); };
  }, []);
  const keyFor = (entry: RemoteEntry) => JSON.stringify([entry.path, entry.size, entry.modified]);
  useEffect(() => {
    if (!enabled && !videosEnabled) {
      local.current.clear();
      return;
    }
    let current = true;
    const controller = new AbortController();
    const generation = remoteThumbnailGeneration();
    worker.current = worker.current.then(async () => {
      for (const entry of visible) {
        if (!current) return;
        const video = videosEnabled && canPreviewRemoteVideo(entry);
        if (!video && !(enabled && canPreviewRemote(entry))) continue;
        const key = keyFor(entry);
        if (local.current.has(key)) continue;
        const cached = getRemoteThumbnail(profileId, sessionId, entry);
        if (cached) continue;
        try {
          const image = await requestRemoteThumbnail(profileId, sessionId, entry, video ? controller.signal : undefined);
          if (!current || generation !== remoteThumbnailGeneration()) return;
          local.current.set(key, image);
          if (local.current.size > 128) local.current.delete(local.current.keys().next().value!);
          if (image) repaint(n => n + 1);
        } catch {
          // Transport failures remain retryable after a reconnect or refresh.
        }
      }
    });
    return () => { current = false; controller.abort(); };
  }, [enabled, videosEnabled, profileId, sessionId, visible, cacheRevision]);
  return (entry: RemoteEntry) => ((enabled && canPreviewRemote(entry)) || (videosEnabled && canPreviewRemoteVideo(entry))) &&
    (getRemoteThumbnail(profileId, sessionId, entry) ?? local.current.get(keyFor(entry)));
}
