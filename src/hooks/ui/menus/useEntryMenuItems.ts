// Assembles the file/folder context menu from focused builder modules.

import { useMemo } from "react";
import {
  copyPathsToClipboard,
  openPathProperties,
  openPathWithDialog,
  openPathWithHandler,
} from "@/api";
import { useClipboardStore, usePromptStore } from "@/modules";
import type {
  ContextMenuItem,
  ConversionModalRequest,
  EntryContextTarget,
  FileEntry,
} from "@/types";
import { buildEntryConvertItems } from "./entryMenu/buildEntryConvertItems";
import { buildEntryCopyItems } from "./entryMenu/buildEntryCopyItems";
import { buildEntryDeleteItems } from "./entryMenu/buildEntryDeleteItems";
import { buildEntryOpenItems } from "./entryMenu/buildEntryOpenItems";
import { buildEntryOpenWithItems } from "./entryMenu/buildEntryOpenWithItems";
import { buildEntryPasteItems } from "./entryMenu/buildEntryPasteItems";
import { buildEntryPropertiesItems } from "./entryMenu/buildEntryPropertiesItems";
import { buildEntryRenameItems } from "./entryMenu/buildEntryRenameItems";
import { resolveActionError, resolveContextTargets } from "./entryMenu/shared";
import { summarizeEntrySelection } from "./entryMenu/summarizeEntrySelection";
import { useOpenWithMenuState } from "./useOpenWithMenuState";

type UseEntryMenuItemsOptions = {
  target: EntryContextTarget | null;
  selected: Set<string>;
  entryByPath: Map<string, FileEntry>;
  parentPath: string | null;
  currentPath: string;
  onOpenEntry: (path: string) => void;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab: (path: string) => void;
  onDeleteEntries: (paths: string[]) => Promise<{ deleted: number } | null>;
  confirmDelete: boolean;
  onClearSelection: () => void;
  onRenameEntry: (target: EntryContextTarget) => void;
  onPasteEntries: (paths: string[], destination: string) => Promise<unknown> | void;
  onOpenConvertModal: (request: ConversionModalRequest) => void;
  onQuickConvertImages: (request: ConversionModalRequest, targetFormat: string) => void;
  ffmpegDetected: boolean;
  menuShowConvert: boolean;
};

export const useEntryMenuItems = ({
  target,
  selected,
  entryByPath,
  parentPath,
  currentPath,
  onOpenEntry,
  onOpenDir,
  onOpenDirNewTab,
  onDeleteEntries,
  confirmDelete,
  onClearSelection,
  onRenameEntry,
  onPasteEntries,
  onOpenConvertModal,
  onQuickConvertImages,
  ffmpegDetected,
  menuShowConvert,
}: UseEntryMenuItemsOptions) => {
  const clipboard = useClipboardStore((state) => state.clipboard);
  const openWithMenuState = useOpenWithMenuState(target);

  return useMemo<ContextMenuItem[]>(() => {
    if (!target) return [];

    const showPrompt = usePromptStore.getState().showPrompt;
    const actionTargets = resolveContextTargets(target, selected, parentPath);
    const selectionSummary = summarizeEntrySelection(actionTargets, target, entryByPath);
    const hasTargets = actionTargets.length > 0;
    const pasteTarget = (target.isDir ? target.path : currentPath).trim();
    const clipboardPaths = clipboard?.paths ?? [];
    const canPaste = Boolean(clipboardPaths.length > 0 && pasteTarget);

    const handleCopyEntries = (paths: string[]) => {
      useClipboardStore.getState().setClipboard(paths);
      void copyPathsToClipboard(paths);
    };

    const handleDeleteEntries = async (paths: string[]) => {
      const report = await onDeleteEntries(paths);
      if (report?.deleted) {
        onClearSelection();
      }
      return report;
    };

    const handleOpenProperties = (paths: string[]) => {
      void openPathProperties(paths).catch((error) => {
        showPrompt({
          title: "Couldn't open properties",
          content: resolveActionError(error, "Unable to open the properties dialog."),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      });
    };

    const handleOpenWithHandler = (path: string, handlerId: string) => {
      void openPathWithHandler(path, handlerId).catch((error) => {
        showPrompt({
          title: "Couldn't open with this app",
          content: resolveActionError(
            error,
            "Unable to open this file with the selected app.",
          ),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      });
    };

    const handleChooseOpenWith = (path: string) => {
      void openPathWithDialog(path).catch((error) => {
        showPrompt({
          title: "Couldn't open Open With",
          content: resolveActionError(
            error,
            "Unable to open the system Open With dialog.",
          ),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      });
    };

    return [
      ...buildEntryOpenItems({
        target,
        hasTargets,
        onOpenEntry,
        onOpenDir,
        onOpenDirNewTab,
      }),
      ...buildEntryOpenWithItems({
        isDir: target.isDir,
        openWithMenuState,
        onOpenWithHandler: handleOpenWithHandler,
        onChooseOpenWith: handleChooseOpenWith,
      }),
      ...buildEntryConvertItems({
        selectionSummary,
        ffmpegDetected,
        menuShowConvert,
        onOpenConvertModal,
        onQuickConvertImages,
      }),
      ...buildEntryCopyItems({
        actionTargets,
        hasTargets,
        onCopyEntries: handleCopyEntries,
      }),
      ...buildEntryRenameItems({
        target,
        hasTargets,
        onRenameEntry,
      }),
      ...buildEntryPasteItems({
        target,
        canPaste,
        clipboardPaths,
        pasteTarget,
        onPasteEntries,
      }),
      ...buildEntryDeleteItems({
        actionTargets,
        hasTargets,
        confirmDelete,
        onDeleteEntries: handleDeleteEntries,
        showPrompt,
      }),
      ...buildEntryPropertiesItems({
        actionTargets,
        hasTargets,
        hasMultiplePropertyTypes: selectionSummary.hasMultiplePropertyTypes,
        onOpenProperties: handleOpenProperties,
      }),
    ];
  }, [
    clipboard,
    currentPath,
    entryByPath,
    ffmpegDetected,
    menuShowConvert,
    onClearSelection,
    onDeleteEntries,
    confirmDelete,
    onOpenConvertModal,
    onOpenDir,
    onOpenDirNewTab,
    onOpenEntry,
    onPasteEntries,
    onQuickConvertImages,
    onRenameEntry,
    openWithMenuState,
    parentPath,
    selected,
    target,
  ]);
};
