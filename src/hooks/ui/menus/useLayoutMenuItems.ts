// Builds context menu items for the empty layout area (paste, shells, sort).
import { useMemo } from "react";
import { useClipboardStore } from "@/modules";
import type { ContextMenuItem, ShellAvailability, ShellKind, SortState } from "@/types";
import { useSortMenuItems } from "./useSortMenuItems";
import { useCreateEntryPrompt } from "../app/useCreateEntryPrompt";

type UseLayoutMenuItemsOptions = {
  currentPath: string;
  sortState: SortState;
  onSortChange: (next: SortState) => void;
  onPaste?: (destination: string) => void;
  preserveWhitespace?: boolean;
  onCreateFolder?: (parentPath: string, name: string) => Promise<unknown> | void;
  onCreateFolderAndGo?: (parentPath: string, name: string) => Promise<unknown> | void;
  onCreateFile?: (parentPath: string, name: string) => Promise<unknown> | void;
  shellAvailability: ShellAvailability | null;
  menuOpenPwsh: boolean;
  menuOpenWsl: boolean;
  onOpenShell: (kind: ShellKind, path: string) => void;
};

export const useLayoutMenuItems = ({
  currentPath,
  sortState,
  onSortChange,
  onPaste,
  preserveWhitespace = false,
  onCreateFolder,
  onCreateFolderAndGo,
  onCreateFile,
  shellAvailability,
  menuOpenPwsh,
  menuOpenWsl,
  onOpenShell,
}: UseLayoutMenuItemsOptions) => {
  const clipboard = useClipboardStore((state) => state.clipboard);
  const remoteClipboard = useClipboardStore((state) => state.remote);
  const sortItems = useSortMenuItems(sortState, onSortChange);
  const openCreatePrompt = useCreateEntryPrompt();

  return useMemo<ContextMenuItem[]>(() => {
    const targetPath = preserveWhitespace ? currentPath : currentPath.trim();
    const canPaste = Boolean(onPaste && (clipboard?.paths.length || remoteClipboard?.entries.length) && targetPath);
    const canCreate = Boolean(targetPath && (onCreateFolder || onCreateFile));
    const showPwsh = Boolean(menuOpenPwsh && shellAvailability?.pwsh);
    const showWsl = Boolean(menuOpenWsl && shellAvailability?.wsl);
    const shellItems: ContextMenuItem[] = [];
    if (showPwsh) {
      shellItems.push({
        id: "layout-shell-pwsh",
        label: "Open in PowerShell",
        icon: "terminal",
        onSelect: () => {
          if (!targetPath) return;
          onOpenShell("pwsh", targetPath);
        },
        disabled: !targetPath,
      });
    }
    if (showWsl) {
      shellItems.push({
        id: "layout-shell-wsl",
        label: "Open in WSL",
        icon: "terminal",
        onSelect: () => {
          if (!targetPath) return;
          onOpenShell("wsl", targetPath);
        },
        disabled: !targetPath,
      });
    }

    return [
      ...(canCreate
        ? ([
            {
              id: "layout-new-folder",
              label: "New folder",
              icon: "new-folder",
              onSelect: () => {
                if (!onCreateFolder || !targetPath) return;
                openCreatePrompt({
                  kind: "folder",
                  parentPath: targetPath,
                  onCreate: onCreateFolder,
                  onCreateAndGo: onCreateFolderAndGo,
                  preserveWhitespace,
                });
              },
              disabled: !targetPath || !onCreateFolder,
            },
            {
              id: "layout-new-file",
              label: "New file",
              icon: "new-file",
              onSelect: () => {
                if (!onCreateFile || !targetPath) return;
                openCreatePrompt({
                  kind: "file",
                  parentPath: targetPath,
                  onCreate: onCreateFile,
                  preserveWhitespace,
                });
              },
              disabled: !targetPath || !onCreateFile,
            },
            ...(onPaste || shellItems.length ? [{ kind: "divider", id: "layout-divider-create" } as ContextMenuItem] : []),
          ] as ContextMenuItem[])
        : []),
      ...(onPaste ? [{
        id: "layout-paste",
        label: "Paste",
        icon: "paste",
        onSelect: () => {
          if (targetPath) onPaste(targetPath);
        },
        disabled: !canPaste,
      } as ContextMenuItem] : []),
      ...(shellItems.length > 0
        ? [{ kind: "divider", id: "layout-divider-shells" } as ContextMenuItem]
        : []),
      ...shellItems,
      { kind: "divider", id: "layout-divider-sort" },
      ...sortItems,
    ];
  }, [
    clipboard,
    remoteClipboard,
    currentPath,
    openCreatePrompt,
    onCreateFile,
    onCreateFolder,
    onCreateFolderAndGo,
    menuOpenPwsh,
    menuOpenWsl,
    onOpenShell,
    onPaste,
    preserveWhitespace,
    shellAvailability?.pwsh,
    shellAvailability?.wsl,
    sortItems,
  ]);
};
