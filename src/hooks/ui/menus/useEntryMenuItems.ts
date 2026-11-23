// Assembles the file/folder context menu from focused builder modules.

import { useMemo } from "react";
import {
  openPathProperties,
  openPathWithDialog,
  openPathWithHandler,
} from "@/api";
import { useClipboardStore, usePromptStore } from "@/modules";
import { clearMoveDestinations, useRecentMoveDestinations } from "@/modules/recentMoveStore";
import type {
  ContextMenuItem,
  ConversionModalRequest,
  EntryContextTarget,
  FileEntry,
} from "@/types";
import { buildEntryConvertItems } from "./entryMenu/buildEntryConvertItems";
import { buildEntryCopyItems } from "./entryMenu/buildEntryCopyItems";
import { buildEntryDeleteItems } from "./entryMenu/buildEntryDeleteItems";
import { buildEntryMoveItems } from "./entryMenu/buildEntryMoveItems";
import { showFolderWithSelectionPrompt, type CreateFolderWithSelection } from "./entryMenu/showFolderWithSelectionPrompt";
import { folderPathKey, getParentPath } from "@/lib/paths";
import { buildEntryOpenItems } from "./entryMenu/buildEntryOpenItems";
import { buildEntryOpenWithItems } from "./entryMenu/buildEntryOpenWithItems";
import { buildEntryPasteItems } from "./entryMenu/buildEntryPasteItems";
import { buildEntryPropertiesItems } from "./entryMenu/buildEntryPropertiesItems";
import { buildEntryRenameItems } from "./entryMenu/buildEntryRenameItems";
import { resolveGalleryStartPath } from "../view/previewGallerySource";
import { resolveActionError, resolveContextTargets } from "./entryMenu/shared";
import { summarizeEntrySelection } from "./entryMenu/summarizeEntrySelection";
import { useOpenWithMenuState } from "./useOpenWithMenuState";

type UseEntryMenuItemsOptions = {
  target: EntryContextTarget | null;
  selected?: Set<string>;
  entryByPath?: Map<string, FileEntry>;
  parentPath?: string | null;
  currentPath?: string;
  onOpenEntry: (path: string) => void;
  onOpenGallery?: (path: string) => void;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab?: (path: string) => void;
  otherPane?: Parameters<typeof buildEntryOpenItems>[0]["otherPane"];
  extraOpenItems?: ContextMenuItem[];
  showClipboardShortcuts?: boolean;
  textCopyTargets?: Parameters<typeof buildEntryCopyItems>[0]["textCopyTargets"];
  onDeleteEntries: (paths: string[]) => Promise<{ deleted: number } | null>;
  confirmDelete: boolean;
  onClearSelection?: () => void;
  onRenameEntry?: (target: EntryContextTarget) => void;
  onPasteEntries?: (destination: string) => Promise<unknown> | void;
  onMoveEntries?: (paths: string[], destination: string) => void;
  onQuickMove?: (paths: string[]) => void;
  onCreateFolderWithSelection?: CreateFolderWithSelection;
  onOpenConvertModal: (request: ConversionModalRequest) => void;
  onQuickConvertImages: (request: ConversionModalRequest, targetFormat: string) => void;
  menuShowConvert: boolean;
};

const EMPTY_SELECTION = new Set<string>();
const EMPTY_ENTRIES = new Map<string, FileEntry>();

export const useEntryMenuItems = ({
  target,
  selected = EMPTY_SELECTION,
  entryByPath = EMPTY_ENTRIES,
  parentPath = null,
  currentPath = "",
  onOpenEntry,
  onOpenGallery,
  onOpenDir,
  onOpenDirNewTab,
  otherPane,
  extraOpenItems,
  showClipboardShortcuts = true,
  textCopyTargets,
  onDeleteEntries,
  confirmDelete,
  onClearSelection,
  onRenameEntry,
  onPasteEntries,
  onMoveEntries,
  onQuickMove,
  onCreateFolderWithSelection,
  onOpenConvertModal,
  onQuickConvertImages,
  menuShowConvert,
}: UseEntryMenuItemsOptions) => {
  const clipboard = useClipboardStore((state) => state.clipboard);
  const { workspaceId, destinations } = useRecentMoveDestinations();
  const openWithMenuState = useOpenWithMenuState(target);

  return useMemo<ContextMenuItem[]>(() => {
    if (!target) return [];

    const showPrompt = usePromptStore.getState().showPrompt;
    const actionTargets = resolveContextTargets(target, selected, parentPath);
    const selectionSummary = summarizeEntrySelection(actionTargets, target, entryByPath);
    const hasTargets = actionTargets.length > 0;
    const currentFolderKey = folderPathKey(currentPath);
    const canGroupSelection = hasTargets && currentFolderKey && actionTargets.every((path) =>
      folderPathKey(getParentPath(path) ?? "") === currentFolderKey);
    const pasteTarget = (target.isDir ? target.path : currentPath).trim();
    const canPaste = Boolean(clipboard?.paths.length && pasteTarget);

    const handleDeleteEntries = async (paths: string[]) => {
      const report = await onDeleteEntries(paths);
      if (report?.deleted) {
        onClearSelection?.();
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
        targetCount: actionTargets.length,
        onOpenEntry,
        onOpenGallery,
        galleryPath: onOpenGallery && resolveGalleryStartPath(target, actionTargets, entryByPath),
        onOpenDir,
        onOpenDirNewTab,
        otherPane,
      }),
      ...(extraOpenItems ?? []),
      ...buildEntryOpenWithItems({
        isDir: target.isDir,
        openWithMenuState,
        onOpenWithHandler: handleOpenWithHandler,
        onChooseOpenWith: handleChooseOpenWith,
      }),
      ...buildEntryConvertItems({
        selectionSummary,
        menuShowConvert,
        onOpenConvertModal,
        onQuickConvertImages,
      }),
      ...buildEntryCopyItems({
        actionTargets,
        hasTargets,
        showShortcuts: showClipboardShortcuts,
        target,
        entryByPath,
        textCopyTargets,
      }),
      ...(onMoveEntries ? buildEntryMoveItems({
        destinations,
        actionTargets,
        onMoveEntries,
        onQuickMove,
        onClear: () => clearMoveDestinations(workspaceId),
      }) : []),
      ...(onCreateFolderWithSelection && canGroupSelection ? [{
        id: "entry-new-folder-with-selection",
        label: "New folder with selection…",
        icon: "new-folder" as const,
        onSelect: () => showFolderWithSelectionPrompt(actionTargets, currentPath, onCreateFolderWithSelection),
      }] : []),
      ...(onRenameEntry ? buildEntryRenameItems({
        target,
        hasTargets,
        multiple: actionTargets.length > 1,
        onRenameEntry,
      }) : []),
      ...(onPasteEntries ? buildEntryPasteItems({
        target,
        canPaste,
        pasteTarget,
        onPasteEntries,
      }) : []),
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
    destinations,
    entryByPath,
    extraOpenItems,
    menuShowConvert,
    onClearSelection,
    onDeleteEntries,
    confirmDelete,
    onOpenConvertModal,
    onOpenDir,
    otherPane,
    onOpenDirNewTab,
    onOpenEntry,
    onOpenGallery,
    onMoveEntries,
    onQuickMove,
    onCreateFolderWithSelection,
    onPasteEntries,
    onQuickConvertImages,
    onRenameEntry,
    openWithMenuState,
    parentPath,
    selected,
    showClipboardShortcuts,
    target,
    textCopyTargets,
    workspaceId,
  ]);
};
