// Internal clipboard for file paths copied from the grid/list.
import { createWithEqualityFn } from "zustand/traditional";

export type ClipboardPayload = {
  paths: string[];
  copiedAt: number;
};

type ClipboardStore = {
  clipboard: ClipboardPayload | null;
  setClipboard: (paths: string[]) => void;
  clearClipboard: () => void;
};

const normalizeClipboardPaths = (paths: string[]) => {
  const seen = new Set<string>();
  const next: string[] = [];
  paths.forEach((path) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    next.push(trimmed);
  });
  return next;
};

export const useClipboardStore = createWithEqualityFn<ClipboardStore>((set) => ({
  clipboard: null,
  setClipboard: (paths) => {
    const normalized = normalizeClipboardPaths(paths);
    if (normalized.length === 0) {
      set({ clipboard: null });
      return;
    }
    set({
      clipboard: {
        paths: normalized,
        copiedAt: Date.now(),
      },
    });
  },
  clearClipboard: () => set({ clipboard: null }),
}));
