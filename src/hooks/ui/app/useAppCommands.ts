// Centralizes app-level commands so App.tsx stays focused on orchestration.
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { clearThumbCache, getThumbCacheDir, openPath, openShell } from "@/api";
import type { DropTarget } from "@/lib";
import { usePromptStore } from "@/modules";
import type { ShellKind } from "@/types";

type UseAppCommandsOptions = {
  browseFromView: (path: string) => void;
  queueCreateSelection: (createdPath: string, parentPath: string) => void;
  createFile: (parentPath: string, name: string) => Promise<string | null>;
  createFolder: (parentPath: string, name: string) => Promise<string | null>;
  performDrop: (paths: string[], targetPath: string) => Promise<unknown>;
  setDropTarget: (target: DropTarget | null) => void;
  setThumbResetNonce: Dispatch<SetStateAction<number>>;
};

export const useAppCommands = ({
  browseFromView,
  queueCreateSelection,
  createFile,
  createFolder,
  performDrop,
  setDropTarget,
  setThumbResetNonce,
}: UseAppCommandsOptions) => {
  const handleCreateFile = useCallback(
    async (parentPath: string, name: string) => {
      const createdPath = await createFile(parentPath, name);
      if (createdPath) {
        queueCreateSelection(createdPath, parentPath);
      }
      return createdPath;
    },
    [createFile, queueCreateSelection],
  );

  const handleCreateFolder = useCallback(
    async (parentPath: string, name: string) => {
      const createdPath = await createFolder(parentPath, name);
      if (createdPath) {
        queueCreateSelection(createdPath, parentPath);
      }
      return createdPath;
    },
    [createFolder, queueCreateSelection],
  );

  const handleCreateFolderAndGo = useCallback(
    async (parentPath: string, name: string) => {
      const createdPath = await createFolder(parentPath, name);
      if (!createdPath) return null;
      browseFromView(createdPath);
      return createdPath;
    },
    [browseFromView, createFolder],
  );

  const handleOpenShell = useCallback((kind: ShellKind, path: string) => {
    const target = path.trim();
    if (!target) return;
    void openShell(kind, target).catch((error) => {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Unable to open the shell here.";
      usePromptStore.getState().showPrompt({
        title: "Couldn't open shell",
        content: message,
        confirmLabel: "OK",
        cancelLabel: null,
      });
    });
  }, []);

  const handleInternalDrop = useCallback(
    (paths: string[], target: DropTarget | null) => {
      if (!target) return;
      void performDrop(paths, target.path);
    },
    [performDrop],
  );

  const handleInternalHover = useCallback(
    (target: DropTarget | null) => {
      setDropTarget(target);
    },
    [setDropTarget],
  );

  const handleOpenThumbCache = useCallback(async () => {
    try {
      const cacheDir = await getThumbCacheDir();
      if (!cacheDir) return;
      await openPath(cacheDir);
    } catch {
      // Ignore cache open errors.
    }
  }, []);

  const handleClearThumbCache = useCallback(async () => {
    try {
      await clearThumbCache();
      setThumbResetNonce((prev) => prev + 1);
    } catch {
      // Ignore cache clear errors.
    }
  }, [setThumbResetNonce]);

  return {
    handleCreateFile,
    handleCreateFolder,
    handleCreateFolderAndGo,
    handleOpenShell,
    handleInternalDrop,
    handleInternalHover,
    handleOpenThumbCache,
    handleClearThumbCache,
  };
};
