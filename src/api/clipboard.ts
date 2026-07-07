// Clipboard integration for sharing file paths with the OS.
import { invoke } from "@tauri-apps/api/core";

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

export const copyPathsToClipboard = async (paths: string[]) => {
  const normalized = normalizeClipboardPaths(paths);
  if (normalized.length === 0) return false;

  try {
    await invoke("set_clipboard_paths", { paths: normalized });
    return true;
  } catch {
    return false;
  }
};

export const getClipboardPaths = async () => {
  return invoke<string[]>("get_clipboard_paths");
};
