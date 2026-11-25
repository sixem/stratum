// Give an idle decoder the first seek immediately. While it is busy, keep the
// latest target and allow it through as soon as the decoder or the user settles.
const SEEK_SETTLE_MS = 100;
type PendingSeek = { target: number; timer: ReturnType<typeof setTimeout>; flush: () => void };
const pending = new WeakMap<HTMLMediaElement, PendingSeek>();

export const previewSeekTime = (media: HTMLMediaElement) => pending.get(media)?.target ?? media.currentTime;

export function cancelPreviewSeek(media: HTMLMediaElement) {
  const seek = pending.get(media);
  if (!seek) return;
  clearTimeout(seek.timer);
  media.removeEventListener("seeked", seek.flush);
  pending.delete(media);
}

function applySeek(media: HTMLMediaElement, target: number) {
  if (typeof media.fastSeek === "function") {
    try { media.fastSeek(target); return; } catch { /* Fall back to exact seeking. */ }
  }
  media.currentTime = target;
}

export function seekPreviewMedia(media: HTMLMediaElement, target: number) {
  cancelPreviewSeek(media);
  if (!media.seeking) {
    applySeek(media, target);
    return;
  }
  const flush = () => {
    cancelPreviewSeek(media);
    if (!media.error) applySeek(media, target);
  };
  const timer = setTimeout(flush, SEEK_SETTLE_MS);
  pending.set(media, { target, timer, flush });
  media.addEventListener("seeked", flush);
}
