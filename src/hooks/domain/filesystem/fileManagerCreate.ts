// Handles create operations (file/folder) for the file manager.
import { useCallback } from "react";
import type { RefObject } from "react";
import { createFile, createFolder } from "@/api";
import { joinPath, normalizePath, toMessage } from "@/lib";
import { usePromptStore } from "@/modules";

type UseFileManagerCreateOptions = {
  currentPathRef: RefObject<string>;
  createInFlightRef: RefObject<boolean>;
  refreshAfterChange: () => Promise<void>;
  onDirectoryChildrenChanged?: (paths: string[]) => void;
};

export const useFileManagerCreate = ({
  currentPathRef,
  createInFlightRef,
  refreshAfterChange,
  onDirectoryChildrenChanged,
}: UseFileManagerCreateOptions) => {
  const createEntryInView = useCallback(
    async (parentPath: string, name: string, kind: "folder" | "file") => {
      if (createInFlightRef.current) return null;
      const parent = parentPath.trim();
      const trimmedName = name.trim();
      if (!parent || !trimmedName) return null;
      const targetPath = joinPath(parent, trimmedName);
      createInFlightRef.current = true;
      try {
        if (kind === "folder") {
          await createFolder(targetPath);
        } else {
          await createFile(targetPath);
        }
        const parentKey = normalizePath(parent);
        const currentKey = normalizePath(currentPathRef.current);
        if (parentKey && currentKey && parentKey === currentKey) {
          await refreshAfterChange();
        }
        onDirectoryChildrenChanged?.([parent]);
        return targetPath;
      } catch (error) {
        const message = toMessage(error, `Failed to create ${kind}.`);
        usePromptStore.getState().showPrompt({
          title: kind === "folder" ? "Create folder failed" : "Create file failed",
          content: message,
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return null;
      } finally {
        createInFlightRef.current = false;
      }
    },
    [createInFlightRef, currentPathRef, onDirectoryChildrenChanged, refreshAfterChange],
  );

  const createFolderInView = useCallback(
    async (parentPath: string, name: string) =>
      createEntryInView(parentPath, name, "folder"),
    [createEntryInView],
  );

  const createFileInView = useCallback(
    async (parentPath: string, name: string) =>
      createEntryInView(parentPath, name, "file"),
    [createEntryInView],
  );

  return {
    createFolderInView,
    createFileInView,
  };
};
