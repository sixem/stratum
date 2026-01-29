// System shell availability checks backed by the Tauri backend.
import { invoke } from "@tauri-apps/api/core";
import type { ShellAvailability, ShellKind } from "@/types";

export const getShellAvailability = () =>
  invoke<ShellAvailability>("get_shell_availability");

export const openShell = (kind: ShellKind, path: string) =>
  invoke<void>("open_shell", { kind, path });
