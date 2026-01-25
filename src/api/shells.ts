// System shell availability checks backed by the Tauri backend.
import { invoke } from "@tauri-apps/api/core";
import type { ShellAvailability, ShellKind } from "@/types";

export function getShellAvailability() {
  return invoke<ShellAvailability>("get_shell_availability");
}

export function openShell(kind: ShellKind, path: string) {
  return invoke<void>("open_shell", { kind, path });
}
