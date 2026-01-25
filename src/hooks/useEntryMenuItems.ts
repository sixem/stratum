// Builds file/folder context menu items for a targeted entry.
import { useMemo } from "react";
import { copyPathsToClipboard, openPathProperties } from "@/api";
import { tabLabel } from "@/lib";
import { useClipboardStore, usePromptStore } from "@/modules";
import type { ContextMenuItem, EntryContextTarget } from "@/types";

type UseEntryMenuItemsOptions = {
  target: EntryContextTarget | null;
  selected: Set<string>;
  parentPath: string | null;
  currentPath: string;
  onOpenEntry: (path: string) => void;
  onOpenDir: (path: string) => void;
  onDeleteEntries: (paths: string[]) => Promise<{ deleted: number } | null>;
  confirmDelete: boolean;
  onClearSelection: () => void;
  onRenameEntry: (target: EntryContextTarget) => void;
  onPasteEntries: (paths: string[], destination: string) => Promise<unknown> | void;
};

const resolveContextTargets = (
  target: EntryContextTarget,
  selected: Set<string>,
  parentPath: string | null,
) => {
  // Prefer the current selection when the right-clicked entry is already selected.
  const useSelection = selected.has(target.path);
  const base = useSelection ? Array.from(selected) : [target.path];
  const filtered = parentPath ? base.filter((path) => path !== parentPath) : base;
  return filtered.length > 0 ? filtered : [target.path];
};

export const useEntryMenuItems = ({
  target,
  selected,
  parentPath,
  currentPath,
  onOpenEntry,
  onOpenDir,
  onDeleteEntries,
  confirmDelete,
  onClearSelection,
  onRenameEntry,
  onPasteEntries,
}: UseEntryMenuItemsOptions) => {
  const clipboard = useClipboardStore((state) => state.clipboard);

  return useMemo<ContextMenuItem[]>(() => {
    if (!target) return [];
    const actionTargets = resolveContextTargets(target, selected, parentPath);
    const hasTargets = actionTargets.length > 0;
    const pasteTarget = (target.isDir ? target.path : currentPath).trim();
    const canPaste = Boolean(clipboard && clipboard.paths.length > 0 && pasteTarget);

    return [
      {
        id: "entry-open",
        label: "Open",
        onSelect: () => {
          if (!hasTargets) return;
          if (target.isDir) {
            onOpenDir(target.path);
          } else {
            onOpenEntry(target.path);
          }
        },
        disabled: !hasTargets,
      },
      {
        id: "entry-copy",
        label: "Copy",
        onSelect: () => {
          if (!hasTargets) return;
          useClipboardStore.getState().setClipboard(actionTargets);
          void copyPathsToClipboard(actionTargets);
        },
        disabled: !hasTargets,
      },
      {
        id: "entry-rename",
        label: "Rename",
        onSelect: () => {
          if (!hasTargets) return;
          onRenameEntry(target);
        },
        disabled: !hasTargets,
      },
      {
        id: "entry-paste",
        label: target.isDir ? "Paste into folder" : "Paste",
        onSelect: () => {
          if (!clipboard || clipboard.paths.length === 0) return;
          if (!pasteTarget) return;
          void onPasteEntries(clipboard.paths, pasteTarget);
        },
        disabled: !canPaste,
      },
      {
        id: "entry-delete",
        label: "Delete",
        onSelect: () => {
          if (!hasTargets) return;
          const count = actionTargets.length;
          const label = count === 1 ? tabLabel(actionTargets[0] ?? "") : `${count} items`;
          const runDelete = () => {
            void Promise.resolve(onDeleteEntries(actionTargets)).then((report) => {
              if (report?.deleted) {
                onClearSelection();
              }
            });
          };
          if (!confirmDelete) {
            runDelete();
            return;
          }
          usePromptStore.getState().showPrompt({
            title: count === 1 ? "Delete item?" : "Delete items?",
            content: `Delete ${label}? You can undo with Ctrl+Z.`,
            confirmLabel: "Delete",
            cancelLabel: "Cancel",
            onConfirm: runDelete,
          });
        },
        disabled: !hasTargets,
      },
      { kind: "divider", id: "entry-divider-properties" },
      {
        id: "entry-properties",
        label: "Properties",
        onSelect: () => {
          if (!hasTargets) return;
          void openPathProperties(target.path).catch((error) => {
            const message =
              error instanceof Error && error.message
                ? error.message
                : "Unable to open the properties dialog.";
            usePromptStore.getState().showPrompt({
              title: "Couldn't open properties",
              content: message,
              confirmLabel: "OK",
              cancelLabel: null,
            });
          });
        },
        disabled: !hasTargets,
      },
    ];
  }, [
    clipboard,
    currentPath,
    onClearSelection,
    onDeleteEntries,
    confirmDelete,
    onOpenDir,
    onOpenEntry,
    onPasteEntries,
    onRenameEntry,
    parentPath,
    selected,
    target,
  ]);
};
