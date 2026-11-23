// Keep the source selection and pane callback stable throughout destination search.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createMoveDestinationGuard } from "@/lib/moveDestination";
import { useIndexedSearchUiStore } from "./indexedSearchUiStore";
import { usePromptStore } from "./promptStore";
import { useSettingsStore } from "./settings.store";
import { useWorkspaceStore } from "./workspaceStore";

type MoveEntries = (paths: string[], destination: string) => void;

type QuickMoveRequest = {
  paths: string[];
  workspaceId: string | null;
  onMove: MoveEntries;
  isDestinationDisabled: (path: string) => boolean;
};

export const useQuickMoveSession = create<{ request: QuickMoveRequest | null }>(() => ({ request: null }));

export const openQuickMove = (paths: readonly string[], onMove: MoveEntries) => {
  if (!paths.length || !useSettingsStore.getState().indexedSearchEnabled ||
      usePromptStore.getState().prompt || useIndexedSearchUiStore.getState().open ||
      useQuickMoveSession.getState().request) return false;
  const selection = [...paths];
  useQuickMoveSession.setState({
    request: {
      paths: selection,
      workspaceId: useWorkspaceStore.getState().activeId,
      onMove,
      isDestinationDisabled: createMoveDestinationGuard(selection),
    },
  });
  return true;
};

export const closeQuickMove = (request: QuickMoveRequest) => {
  if (useQuickMoveSession.getState().request === request) useQuickMoveSession.setState({ request: null });
};

export const confirmQuickMove = async (request: QuickMoveRequest, path: string) => {
  if (useQuickMoveSession.getState().request !== request) return;
  if (request.isDestinationDisabled(path)) return "Choose a different folder.";
  let exists: boolean;
  try {
    exists = await invoke<boolean>("quick_move_destination_exists", { path });
  } catch {
    return "Couldn't check this folder.";
  }
  // An old validation may finish after Escape or a workspace restore.
  if (useQuickMoveSession.getState().request !== request ||
      useWorkspaceStore.getState().activeId !== request.workspaceId ||
      !useSettingsStore.getState().indexedSearchEnabled) return;
  if (!exists) return "Folder unavailable.";
  if (usePromptStore.getState().prompt) return "Finish the open prompt first.";
  closeQuickMove(request);
  request.onMove(request.paths, path);
};
