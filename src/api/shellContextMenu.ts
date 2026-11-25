import { invoke } from "@tauri-apps/api/core";

export type ShellMenuTarget = { paths: string[] } | { backgroundPath: string };
type ShellMenuOutcome = "dismissed" | "invoked" | "gallery";

export const warmShellContextMenu = () => invoke<void>("warm_shell_context_menu");

export const showShellContextMenu = (
  target: ShellMenuTarget,
  point: { x: number; y: number },
  extended: boolean,
  offerGallery: boolean,
) => invoke<ShellMenuOutcome>("show_shell_context_menu", {
  paths: "paths" in target ? target.paths : [],
  backgroundPath: "backgroundPath" in target ? target.backgroundPath : null,
  // Windows translates physical client pixels into screen coordinates on the host monitor.
  x: Math.round(point.x * window.devicePixelRatio),
  y: Math.round(point.y * window.devicePixelRatio),
  extended,
  offerGallery,
});
