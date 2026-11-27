// Route remote drags to local or remote panes without presenting remote paths as Windows files.
import { useCallback, useEffect, useRef } from "react";
import { getDropTargetFromPoint, type DropTarget } from "@/lib/dropTarget";
import { getPaneDirectory } from "@/hooks/ui/menus/usePaneTransferTarget";
import { copyRemoteFiles } from "@/modules/remoteTransfer";
import { useRemoteDrag } from "@/modules/remoteDrag";
import { usePromptStore } from "@/modules/promptStore";
import type { LinkedPane } from "@/lib/paneLink";
import type { RemoteEntry } from "./remoteDirectory";
import { moveRemoteEntries } from "./remoteMove";
import { connectRemote, useRemoteHosts } from "@/modules/remoteHosts";
import { getPaneSessionStore } from "@/modules/sessionStore";

export function useRemoteEntryDrag(pane: LinkedPane, profileId: string, sessionId: number, remotePath: string, entryByPath: ReadonlyMap<string, RemoteEntry>) {
  const release = useRef<() => void>(() => {});
  useEffect(() => () => release.current(), []);
  return useCallback((paths: string[]) => {
    release.current();
    let target: DropTarget | null = null;
    const clear = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", clear, true);
      window.removeEventListener("blur", clear);
      window.removeEventListener("keydown", key, true);
      useRemoteDrag.setState({ target: null, remoteTarget: null });
      release.current = () => {};
    };
    const move = (event: PointerEvent) => {
      const hit = getDropTargetFromPoint(event.clientX, event.clientY);
      const location = hit?.pane ? getPaneDirectory(hit.pane) : undefined;
      const local = hit && (hit.kind === "pane" || hit.kind === "entry") && hit.pane !== pane && location?.kind === "local";
      const remote = hit && (hit.kind === "remote-pane" || hit.kind === "remote-entry") && location?.kind === "remote" &&
        (hit.pane !== pane || hit.kind === "remote-entry");
      const tab = hit && (hit.kind === "tab" || hit.kind === "tab-destination" || hit.kind === "remote-tab");
      target = local || remote || tab ? hit : null;
      useRemoteDrag.setState({ target, remoteTarget: remote ? target : null });
    };
    const up = (event: PointerEvent) => {
      move(event);
      const chosen = target;
      clear();
      if (!chosen || chosen.kind === "tab-submenu") return;
      if (chosen.kind === "tab" || chosen.kind === "tab-destination") {
        void copyRemoteFiles(paths, { profileId, sessionId, path: remotePath }, chosen.path, "download", event.shiftKey, undefined, entryByPath);
        return;
      }
      if (chosen.kind === "remote-tab") {
        const destId = chosen.profileId;
        const profile = useRemoteHosts.getState().profiles.find(item => item.id === destId);
        if (!profile) return;
        void (async () => {
          try {
            await connectRemote(profile);
            const destSession = useRemoteHosts.getState().connections[profile.id]?.sessionId;
            if (!destSession) throw new Error("The destination host is disconnected.");
            const tab = (["main", "bottom"] as const).flatMap(pane => getPaneSessionStore(pane).getState().tabs).find(tab => tab.id === chosen.tabId);
            if (!tab || tab.kind !== "remote" || tab.remote.hostId !== profile.id || tab.remote.path !== chosen.path) throw new Error("The destination tab changed. Try again.");
            if (profile.id === profileId && destSession === sessionId && !event.ctrlKey) {
              const entries = paths.flatMap(path => entryByPath.has(path) ? [entryByPath.get(path)!] : []);
              if (entries.length !== paths.length) throw new Error("The selection changed. Refresh and try again.");
              await moveRemoteEntries(entries, profileId, sessionId, remotePath, chosen.path);
            } else {
              await copyRemoteFiles(paths, { profileId, sessionId, path: remotePath }, "", "download", !event.ctrlKey,
                { profileId: profile.id, sessionId: destSession, path: chosen.path }, entryByPath);
            }
          } catch (error) { usePromptStore.getState().showPrompt({ title: "Transfer failed", content: String(error), confirmLabel: "OK", cancelLabel: null }); }
        })();
        return;
      }
      if (!chosen.pane) return;
      const location = getPaneDirectory(chosen.pane);
      if ((chosen.kind === "remote-pane" || chosen.kind === "remote-entry") && location?.kind === "remote" &&
          (location.profileId !== profileId || location.sessionId !== sessionId)) {
        if (event.altKey) {
          usePromptStore.getState().showPrompt({ title: "Action unavailable", content: "Use Ctrl to copy or drag without modifiers to move.", confirmLabel: "OK", cancelLabel: null });
          return;
        }
        const destination = chosen.kind === "remote-pane" ? location.path : chosen.path;
        void copyRemoteFiles(paths, { profileId, sessionId, path: remotePath }, "", "download", !event.ctrlKey,
          { profileId: location.profileId, sessionId: location.sessionId, path: destination }, entryByPath);
        return;
      }
      if ((chosen.kind === "remote-pane" || chosen.kind === "remote-entry") && location?.kind === "remote" &&
          location.profileId === profileId && location.sessionId === sessionId) {
        if (event.altKey) {
          usePromptStore.getState().showPrompt({ title: "Action unavailable", content: "Use Ctrl to copy or drag without modifiers to move.", confirmLabel: "OK", cancelLabel: null });
          return;
        }
        if (event.ctrlKey) {
          const destination = chosen.kind === "remote-pane" ? location.path : chosen.path;
          void copyRemoteFiles(paths, { profileId, sessionId, path: remotePath }, "", "download", false,
            { profileId: location.profileId, sessionId: location.sessionId, path: destination }, entryByPath);
          return;
        }
        const entries = paths.flatMap(path => entryByPath.has(path) ? [entryByPath.get(path)!] : []);
        if (entries.length !== paths.length) {
          usePromptStore.getState().showPrompt({ title: "Move unavailable", content: "The selection changed. Refresh and try again.", confirmLabel: "OK", cancelLabel: null });
          return;
        }
        const destination = chosen.kind === "remote-pane" ? location.path : chosen.path;
        void moveRemoteEntries(entries, profileId, sessionId, remotePath, destination);
        return;
      }
      if (event.altKey) {
        usePromptStore.getState().showPrompt({ title: "Action unavailable", content: "Use Shift to move or drag without modifiers to copy.", confirmLabel: "OK", cancelLabel: null });
        return;
      }
      const local = getPaneDirectory(chosen.pane);
      if (!local || local.kind !== "local") return;
      void copyRemoteFiles(paths, { profileId, sessionId, path: remotePath }, chosen.path, "download", event.shiftKey, undefined, entryByPath);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
    release.current = clear;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", clear, true);
    window.addEventListener("blur", clear);
    window.addEventListener("keydown", key, true);
  }, [pane, profileId, sessionId, remotePath, entryByPath]);
}
