// Resolve a remote drag destination before showing its action or accepting a drop.
import type { DropTarget } from "../../lib/dropTarget.ts";

type Pane = "main" | "bottom";
type RemoteSource = {
  pane: Pane;
  profileId: string;
  sessionId: number;
  parent: string;
  entries: readonly { path: string; isDir: boolean; isSymlink?: boolean }[];
};
type PaneLocation = { kind: "local"; path: string } | { kind: "remote"; path: string; profileId: string; sessionId: number };
type Modifiers = { ctrlKey: boolean; altKey: boolean };

export function resolveRemoteDragTarget(
  target: DropTarget | null,
  source: RemoteSource,
  location: PaneLocation | undefined,
  modifiers: Modifiers,
): DropTarget | null {
  if (!target || target.kind === "tab-submenu" || modifiers.altKey || !source.entries.length) return null;
  let sameHost = false;
  let destination: string | undefined;
  let remote = false;
  if (target.kind === "remote-tab") {
    if (!target.profileId) return null;
    remote = true;
    destination = target.path;
    sameHost = target.profileId === source.profileId;
  } else if (target.kind === "remote-pane" || target.kind === "remote-entry" || target.kind === "remote-crumb") {
    if (!target.pane || location?.kind !== "remote") return null;
    if (target.kind === "remote-crumb" && (target.profileId !== location.profileId || target.sessionId !== location.sessionId)) return null;
    if (location.profileId === source.profileId && location.sessionId !== source.sessionId) return null;
    if (target.kind === "remote-pane" && (target.pane === source.pane || target.path !== location.path)) return null;
    remote = true;
    destination = target.kind === "remote-pane" ? location.path : target.path;
    sameHost = location.profileId === source.profileId && location.sessionId === source.sessionId;
  } else if (target.kind === "tab" || target.kind === "tab-destination") {
    // Local tabs do not need a pane directory to remain open.
  } else if (target.kind === "entry" && !target.pane) {
    // Sidebar places are local destinations independent of the active pane.
  } else if ((target.kind === "entry" || target.kind === "pane") && target.pane &&
      target.pane !== source.pane && location?.kind === "local") {
    // Local folder rows, breadcrumbs, and pane backgrounds use their own path.
  } else return null;

  if (remote && sameHost && destination) {
    const insideSelection = source.entries.some(entry => destination === entry.path ||
      (entry.isDir && !entry.isSymlink && destination.startsWith(`${entry.path.replace(/\/+$/, "")}/`)));
    if (destination === source.parent || insideSelection) return null;
  }

  // SFTP links can be renamed on their host, but cannot be copied or downloaded.
  if (source.entries.some(entry => entry.isSymlink) && (!remote || !sameHost || modifiers.ctrlKey)) return null;
  return target;
}
