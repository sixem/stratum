// Playback and portable backups use the same stored volume range.
export const DEFAULT_PREVIEW_VOLUME = 0.1;
export const clampVolume = (value: number) => Math.min(1, Math.max(0, value));

export function readPreviewVolume(key: string) {
  try {
    const stored = globalThis.localStorage.getItem(key);
    const volume = stored === null ? DEFAULT_PREVIEW_VOLUME : Number(stored);
    return Number.isFinite(volume) ? clampVolume(volume) : DEFAULT_PREVIEW_VOLUME;
  } catch {
    return DEFAULT_PREVIEW_VOLUME;
  }
}
