// Derive a small thumbnail from an image the gallery has already decoded.
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/modules/settings.store";
import { REMOTE_THUMBNAIL_UPDATED } from "@/components/remote/remoteThumbnailCache";

export function cacheRemoteGalleryImage(image: HTMLImageElement, token: string) {
  // Wait until the gallery has painted before scaling a potentially large image.
  window.setTimeout(() => {
    try {
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height || width > 16384 || height > 16384) return;
      const scale = Math.min(128 / width, 128 / height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.8);
      if (!data.startsWith("data:image/jpeg;base64,")) return;
      void invoke<boolean>("store_remote_gallery_thumbnail", {
        token, image: data, cacheMb: useSettingsStore.getState().thumbnailCacheMb,
      }).then(stored => { if (stored) window.dispatchEvent(new Event(REMOTE_THUMBNAIL_UPDATED)); }).catch(() => {});
    } catch { /* A rejected canvas or closed preview simply keeps the normal icon. */ }
  }, 0);
}
