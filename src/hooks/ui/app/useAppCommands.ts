// Centralizes app-level commands so App.tsx stays focused on orchestration.
import { useCallback } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { clearThumbCache, getThumbCacheDir, openPath, openShell } from "@/api";
import { usePromptStore } from "@/modules";
import type { ShellKind } from "@/types";

type UseAppCommandsOptions = {
  viewVisit: RefObject<boolean>;
  browseFromView: (path: string) => void;
  queueCreateSelection: (createdPath: string, parentPath: string) => void;
  createFile: (parentPath: string, name: string) => Promise<string | null>;
  createFolder: (parentPath: string, name: string) => Promise<string | null>;
  setThumbResetNonce: Dispatch<SetStateAction<number>>;
};

export const useAppCommands = ({
  viewVisit,
  browseFromView,
  queueCreateSelection,
  createFile,
  createFolder,
  setThumbResetNonce,
}: UseAppCommandsOptions) => {
  const handleCreateFile = useCallback(
    async (parentPath: string, name: string) => {
      const createdPath = await createFile(parentPath, name);
      if (createdPath && viewVisit.current) {
        queueCreateSelection(createdPath, parentPath);
      }
      return createdPath;
    },
    [createFile, queueCreateSelection, viewVisit],
  );

  const handleCreateFolder = useCallback(
    async (parentPath: string, name: string) => {
      const createdPath = await createFolder(parentPath, name);
      if (createdPath && viewVisit.current) {
        queueCreateSelection(createdPath, parentPath);
      }
      return createdPath;
    },
    [createFolder, queueCreateSelection, viewVisit],
  );

  const handleCreateFolderAndGo = useCallback(
    async (parentPath: string, name: string) => {
      const createdPath = await createFolder(parentPath, name);
      if (createdPath && viewVisit.current) browseFromView(createdPath);
      return createdPath;
    },
    [browseFromView, createFolder, viewVisit],
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
    handleOpenThumbCache,
    handleClearThumbCache,
  };
};
