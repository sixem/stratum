// Keep the source selection and pane callback stable throughout destination search.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createMoveDestinationGuard } from "@/lib/moveDestination";
import { useIndexedSearchUiStore } from "./indexedSearchUiStore";
import { usePromptStore } from "./promptStore";
import { useSettingsStore } from "./settings.store";
import { copyRemoteFiles, transferRemoteSelection } from "./remoteTransfer";
import { currentMoveSession, hasConnectedHost, type RemoteMoveLocation } from "./remoteQuickMoveFolders";
import { useRemoteHosts } from "./remoteHosts";
import { toMessage } from "@/lib/fsUtils";
import type { RemoteEntry } from "@/components/remote/remoteDirectory";
import { useWorkspaceStore } from "./workspaceStore";

type MoveEntries = (paths: string[], destination: string) => void;

export type MoveDestination = string | RemoteMoveLocation;
type Source = { kind: "local"; onMove: MoveEntries } |
  { kind: "remote"; folder: RemoteMoveLocation; entries: RemoteEntry[] };

type QuickMoveRequest = {
  paths: string[];
  workspaceId: string | null;
  source: Source;
  isDestinationDisabled: (target: MoveDestination) => boolean;
};

export const useQuickMoveSession = create<{ request: QuickMoveRequest | null }>(() => ({ request: null }));

function beginQuickMove(paths: string[], source: Source, isDestinationDisabled: QuickMoveRequest["isDestinationDisabled"]) {
  if (!paths.length || (!useSettingsStore.getState().indexedSearchEnabled && !hasConnectedHost(useRemoteHosts.getState())) ||
      usePromptStore.getState().prompt || useIndexedSearchUiStore.getState().open || useQuickMoveSession.getState().request) return false;
  useQuickMoveSession.setState({ request: { paths, source, isDestinationDisabled, workspaceId: useWorkspaceStore.getState().activeId } });
  return true;
}

export function openQuickMove(paths: readonly string[], onMove: MoveEntries) {
  const selection = [...paths];
  const guard = createMoveDestinationGuard(selection);
  return beginQuickMove(selection, { kind: "local", onMove }, target => typeof target === "string" && guard(target));
}

export function openRemoteQuickMove(folder: RemoteMoveLocation, entries: RemoteEntry[]) {
  if (!currentMoveSession(folder)) return false;
  const paths = entries.map(entry => entry.path);
  const hasLink = entries.some(entry => entry.isSymlink);
  return beginQuickMove(paths, { kind: "remote", folder, entries }, target => {
    if (typeof target === "string" || target.profileId !== folder.profileId) return hasLink;
    if (folder.path === target.path) return true;
    return paths.some(path => path === target.path || target.path.startsWith(path + "/"));
  });
}

export const closeQuickMove = (request: QuickMoveRequest) => {
  if (useQuickMoveSession.getState().request === request) useQuickMoveSession.setState({ request: null });
};

export const confirmQuickMove = async (request: QuickMoveRequest, target: MoveDestination) => {
  const validRequest = () => useQuickMoveSession.getState().request === request &&
    useWorkspaceStore.getState().activeId === request.workspaceId;
  if (!validRequest()) return;
  if (request.isDestinationDisabled(target)) return "Choose a different folder.";
  let destination = target;
  try {
    if (typeof target === "string") {
      if (!useSettingsStore.getState().indexedSearchEnabled ||
          !await invoke<boolean>("quick_move_destination_exists", { path: target })) return "Folder unavailable.";
    } else {
      if (!currentMoveSession(target)) return "The destination host disconnected. Select a connected folder.";
      const resolved = await invoke<{ kind: string; path: string }>("remote_resolve_target", {
        profileId: target.profileId, sessionId: target.sessionId, path: target.path,
      });
      if (!currentMoveSession(target)) return "The destination session changed. Select the folder again.";
      if (resolved.kind !== "directory") return "The remote destination is no longer a folder.";
      destination = { ...target, path: resolved.path };
      if (request.isDestinationDisabled(destination)) return "Choose a different folder.";
    }
  } catch (error) {
    return toMessage(error, "Couldn't check this folder.");
  }
  if (!validRequest()) return;
  if (typeof destination === "string" && !useSettingsStore.getState().indexedSearchEnabled) return "Folder unavailable.";
  if (usePromptStore.getState().prompt) return "Finish the open prompt first.";
  const { source, paths } = request;
  if (source.kind === "remote" && !currentMoveSession(source.folder)) return "The source session changed. Select the items again.";
  closeQuickMove(request);
  if (source.kind === "remote") {
    void transferRemoteSelection(source.entries, source.folder, destination, true);
  } else if (typeof destination === "string") {
    source.onMove(paths, destination);
  } else {
    void copyRemoteFiles(paths, destination, "", "upload", true);
  }
};
