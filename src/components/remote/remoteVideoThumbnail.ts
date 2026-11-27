import { invoke } from "@tauri-apps/api/core";
import { releasePreviewGrant } from "@/api/preview";
import { buildPreviewUrl } from "@/lib/previewUrl";
import { useSettingsStore } from "@/modules/settings.store";
import type { RemoteEntry } from "./remoteDirectory";

// A single decoder across panes avoids parallel SFTP and media-decoder pressure.
let queue: Promise<unknown> = Promise.resolve();

function frame(url: string, signal: AbortSignal): Promise<string | null> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(null); return; }
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    let done = false;
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      video.removeAttribute("src");
      video.load();
      resolve(result);
    };
    const cancel = () => finish(null);
    const timer = window.setTimeout(cancel, 8000);
    signal.addEventListener("abort", cancel, { once: true });
    video.onerror = cancel;
    video.onloadeddata = () => {
      try {
        const width = video.videoWidth, height = video.videoHeight;
        if (!width || !height || width > 16384 || height > 16384) { finish(null); return; }
        const scale = Math.min(128 / width, 128 / height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) { finish(null); return; }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        // WebView's WebP encoder can add extended chunks rejected by our
        // hardened decoder. JPEG is decoded and stored as WebP in the backend.
        const image = canvas.toDataURL("image/jpeg", 0.8);
        finish(image.startsWith("data:image/jpeg;base64,") ? image : null);
      } catch { finish(null); }
    };
    video.src = url;
    video.load();
  });
}

export function requestRemoteVideoThumbnail(profileId: string, sessionId: number, entry: RemoteEntry, signal: AbortSignal) {
  const run = async () => {
    if (signal.aborted) return null;
    const prepared = await invoke<{ token: string | null; cached: string | null }>("prepare_remote_video_thumbnail", {
      profileId, sessionId, path: entry.path,
    });
    if (prepared.cached) return signal.aborted ? null : prepared.cached;
    if (!prepared.token) return null;
    try {
      if (signal.aborted) return null;
      const image = await frame(buildPreviewUrl(prepared.token), signal);
      if (!image || signal.aborted) return null;
      return await invoke<string | null>("store_remote_video_thumbnail", {
        token: prepared.token, image, cacheMb: useSettingsStore.getState().thumbnailCacheMb,
      });
    } finally {
      void releasePreviewGrant(prepared.token).catch(() => {});
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}
