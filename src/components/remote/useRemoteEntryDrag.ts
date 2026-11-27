// Route remote drags to local or remote panes without presenting remote paths as Windows files.
import { useCallback, useEffect, useRef } from "react";
import { getDropTargetFromPoint, type DropTarget } from "@/lib/dropTarget";
import { getPaneDirectory } from "@/hooks/ui/menus/usePaneTransferTarget";
import { copyRemoteFiles } from "@/modules/remoteTransfer";
import { useRemoteDrag } from "@/modules/remoteDrag";
import { usePromptStore } from "@/modules/promptStore";
import type { LinkedPane } from "@/lib/paneLink";
import { remoteParent, type RemoteEntry } from "./remoteDirectory";
import { moveRemoteEntries } from "./remoteMove";
import { useRemoteHosts } from "@/modules/remoteHosts";
import { prepareRemoteTabDrop } from "@/modules/remoteTabDrop";
import type { EntryDragStart } from "@/types";
import { remoteDragAction } from "./remoteDragFeedback";
import { resolveRemoteDragTarget } from "./remoteDragPolicy";

// Preserve target identity between pointer moves within the same destination.
const sameTarget = (a: DropTarget | null, b: DropTarget | null) =>
  a === b || Boolean(a && b && a.kind === b.kind && a.pane === b.pane && a.tabId === b.tabId &&
    (a.kind === "tab-submenu" || b.kind === "tab-submenu" || a.path === b.path) && a.profileId === b.profileId && a.sessionId === b.sessionId);

export function useRemoteEntryDrag(pane: LinkedPane, profileId: string, sessionId: number, remotePath: string, entryByPath: ReadonlyMap<string, RemoteEntry>) {
  const release = useRef<() => void>(() => {});
  useEffect(() => () => release.current(), []);
  return useCallback((paths: string[], _folderPath?: string, start?: EntryDragStart) => {
    release.current();
    // Parent rows can be part of a range selection, but are not draggable entries.
    const sourcePaths = paths.filter(path => path !== remoteParent(remotePath));
    const entries = sourcePaths.flatMap(path => entryByPath.has(path) ? [entryByPath.get(path)!] : []);
    if (entries.length !== sourcePaths.length) {
      usePromptStore.getState().showPrompt({ title: "Drag unavailable", content: "The selection changed. Refresh and try again.", confirmLabel: "OK", cancelLabel: null });
      return;
    }
    if (!entries.length) return;
    const source = { pane, profileId, sessionId, parent: remotePath, entries };
    let target: DropTarget | null = null;
    let point = start ? { x: start.x, y: start.y } : { x: 0, y: 0 };
    const firstEntry = entries[0];
    const clear = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", clear, true);
      window.removeEventListener("blur", clear);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
      useRemoteDrag.setState({ target: null, remoteTarget: null, preview: null });
      release.current = () => {};
    };
    const update = (modifiers: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => {
      const hit = getDropTargetFromPoint(point.x, point.y);
      const location = hit?.pane ? getPaneDirectory(hit.pane) : undefined;
      const connection = useRemoteHosts.getState().connections[profileId];
      const nextTarget = connection?.status === "connected" && connection.sessionId === sessionId
        ? resolveRemoteDragTarget(hit, source, location, modifiers) : null;
      if (!sameTarget(target, nextTarget)) target = nextTarget;
      const action = remoteDragAction(target, modifiers);
      const remote = target?.kind === "remote-pane" || target?.kind === "remote-entry" || target?.kind === "remote-crumb";
      useRemoteDrag.setState({ target, remoteTarget: remote ? target : null,
        preview: { name: firstEntry.name, isDir: firstEntry.isDir,
          count: entries.length, ...point, action } });
    };
    const move = (event: PointerEvent) => {
      if (!(event.buttons & 1)) { clear(); return; }
      point = { x: event.clientX, y: event.clientY };
      update(event);
    };
    const up = (event: PointerEvent) => {
      point = { x: event.clientX, y: event.clientY };
      update(event);
      const chosen = target;
      clear();
      if (!chosen || chosen.kind === "tab-submenu") return;
      if (chosen.kind === "tab" || chosen.kind === "tab-destination") {
        void copyRemoteFiles(sourcePaths, { profileId, sessionId, path: remotePath }, chosen.path, "download", event.shiftKey, undefined, entryByPath);
        return;
      }
      if (chosen.kind === "remote-tab") {
        void (async () => {
          try {
            const dest = await prepareRemoteTabDrop(chosen, sourcePaths, !event.ctrlKey);
            if (!dest) return;
            if (dest.profileId === profileId && dest.sessionId === sessionId && !event.ctrlKey) {
              await moveRemoteEntries(entries, profileId, sessionId, remotePath, dest.path, dest.transferId);
            } else {
              await copyRemoteFiles(sourcePaths, { profileId, sessionId, path: remotePath }, "", "download", !event.ctrlKey, dest, entryByPath, dest.transferId);
            }
          } catch (error) { usePromptStore.getState().showPrompt({ title: "Transfer failed", content: String(error), confirmLabel: "OK", cancelLabel: null }); }
        })();
        return;
      }
      if (chosen.kind === "entry" && !chosen.pane) {
        void copyRemoteFiles(sourcePaths, { profileId, sessionId, path: remotePath }, chosen.path, "download", event.shiftKey, undefined, entryByPath);
        return;
      }
      if (!chosen.pane) return;
      const location = getPaneDirectory(chosen.pane);
      if ((chosen.kind === "remote-pane" || chosen.kind === "remote-entry" || chosen.kind === "remote-crumb") && location?.kind === "remote") {
        const destination = chosen.kind === "remote-pane" ? location.path : chosen.path;
        if (location.profileId === profileId && location.sessionId === sessionId && !event.ctrlKey) {
          void moveRemoteEntries(entries, profileId, sessionId, remotePath, destination);
        } else {
          void copyRemoteFiles(sourcePaths, { profileId, sessionId, path: remotePath }, "", "download", !event.ctrlKey,
            { profileId: location.profileId, sessionId: location.sessionId, path: destination }, entryByPath);
        }
        return;
      }
      if (!location || location.kind !== "local") return;
      void copyRemoteFiles(sourcePaths, { profileId, sessionId, path: remotePath }, chosen.path, "download", event.shiftKey, undefined, entryByPath);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); clear(); }
      else if (event.key === "Control" || event.key === "Shift" || event.key === "Alt") update(event);
    };
    release.current = clear;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", clear, true);
    window.addEventListener("blur", clear);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    if (start) update(start);
  }, [pane, profileId, sessionId, remotePath, entryByPath]);
}
