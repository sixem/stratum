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
  onPaste: (destination: string) => void;
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
  onCreateFolder,
  onCreateFolderAndGo,
  onCreateFile,
  shellAvailability,
  menuOpenPwsh,
  menuOpenWsl,
  onOpenShell,
}: UseLayoutMenuItemsOptions) => {
  const clipboard = useClipboardStore((state) => state.clipboard);
  const sortItems = useSortMenuItems(sortState, onSortChange);
  const openCreatePrompt = useCreateEntryPrompt();

  return useMemo<ContextMenuItem[]>(() => {
    const targetPath = currentPath.trim();
    const canPaste = Boolean(clipboard?.paths.length && targetPath);
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
                });
              },
              disabled: !targetPath || !onCreateFile,
            },
            { kind: "divider", id: "layout-divider-create" } as ContextMenuItem,
          ] as ContextMenuItem[])
        : []),
      {
        id: "layout-paste",
        label: "Paste",
        icon: "paste",
        onSelect: () => {
          if (targetPath) onPaste(targetPath);
        },
        disabled: !canPaste,
      },
      ...(shellItems.length > 0
        ? [{ kind: "divider", id: "layout-divider-shells" } as ContextMenuItem]
        : []),
      ...shellItems,
      { kind: "divider", id: "layout-divider-sort" },
      ...sortItems,
    ];
  }, [
    clipboard,
    currentPath,
    openCreatePrompt,
    onCreateFile,
    onCreateFolder,
    onCreateFolderAndGo,
    menuOpenPwsh,
    menuOpenWsl,
    onOpenShell,
    onPaste,
    shellAvailability?.pwsh,
    shellAvailability?.wsl,
    sortItems,
  ]);
};
