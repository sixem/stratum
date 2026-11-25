// File clipboard IPC. The sequence identifies the exact Cut that a move consumed.
import { invoke } from "@tauri-apps/api/core";

export type FileClipboardMode = "copy" | "move";

export type FileClipboard = {
  paths: string[];
  mode: FileClipboardMode;
  sequence: number;
};

export const setFileClipboard = (paths: string[], mode: FileClipboardMode) =>
  invoke<void>("set_clipboard_paths", { paths, mode });

export const setTextClipboard = (text: string) => invoke<void>("set_clipboard_text", { text });

export const getFileClipboard = () => invoke<FileClipboard>("get_file_clipboard");

export const finishFileCut = (sequence: number, moved: string[]) =>
  invoke<void>("finish_file_cut", { sequence, moved });
