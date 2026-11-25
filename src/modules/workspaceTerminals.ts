// Only descriptors captured in this window can refer to a running PowerShell.
import type { Tab, TerminalSession } from "@/types/tabs";
import type { WorkspaceLayout, WorkspaceSession } from "./workspaceStore";

export type WorkspaceShells = Map<TerminalSession, string>;
const parked = new Map<string | null, WorkspaceShells>();
const retained = new Set<string>();
export const liveShellKeys = new Set<string>();
const shellOf = (tab: Tab) => tab.terminal ?? tab.split?.terminal;

export const parkedWorkspaceShells = (id: string | null) => parked.get(id);
export const isParkedShell = (key: string) => retained.has(key);

function* bindingsFor(layout: WorkspaceLayout, shells: WorkspaceShells) {
  for (const pane of [layout.main, layout.bottom]) {
    for (const tab of pane.tabs) {
      const descriptor = shellOf(tab);
      const key = descriptor && shells.get(descriptor);
      if (descriptor && key) yield [descriptor, key] as const;
    }
  }
}

export function hasUnreachableShells(previous: WorkspaceSession, named?: WorkspaceLayout) {
  const shells = parked.get(previous.id);
  if (!shells) return false;
  const reachableKeys = new Set(named ? new Map(bindingsFor(named, shells)).values() : []);
  for (const [, key] of bindingsFor(previous.layout, shells)) {
    if (!reachableKeys.has(key)) return true;
  }
  return false;
}

export function parkWorkspaceShells(outgoing: WorkspaceSession, saved?: WorkspaceLayout) {
  const shells: WorkspaceShells = new Map();
  for (const pane of ["main", "bottom"] as const) {
    outgoing.layout[pane].tabs.forEach((tab, index) => {
      const shell = shellOf(tab);
      if (!shell || !liveShellKeys.has(shell.key)) return;
      shells.set(shell, shell.key);
      // An unchanged named snapshot can have older tab IDs. Its tab order
      // corresponds to the live layout; a changed workspace uses its draft.
      const snapshot = saved?.[pane].tabs[index];
      const descriptor = snapshot && shellOf(snapshot);
      if (descriptor) shells.set(descriptor, shell.key);
    });
  }
  if (shells.size) parked.set(outgoing.id, shells);
  else parked.delete(outgoing.id);
}

// Drop ownership when a snapshot is replaced, deleted, or reopened. Ordinary
// tab closes can then release the native process through the usual pane cleanup.
export function retainWorkspaceShells(sessions: Iterable<WorkspaceSession>) {
  retained.clear();
  if (!parked.size) return;
  const reachable = new Map<string | null, WorkspaceShells>();
  for (const { id, layout } of sessions) {
    const shells = parked.get(id);
    if (!shells) continue;
    const kept = reachable.get(id) ?? new Map<TerminalSession, string>();
    for (const [descriptor, key] of bindingsFor(layout, shells)) {
      kept.set(descriptor, key);
      retained.add(key);
    }
    if (kept.size) reachable.set(id, kept);
  }
  parked.clear();
  for (const [id, shells] of reachable) parked.set(id, shells);
}
