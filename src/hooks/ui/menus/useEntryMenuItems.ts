// Builds file/folder context menu items for a targeted entry.
import { useMemo } from "react";
import { copyPathsToClipboard, openPathProperties } from "@/api";
import {
  CONVERT_FORMAT_LABELS,
  IMAGE_CONVERT_EXTENSIONS,
  VIDEO_CONVERT_EXTENSIONS,
} from "@/constants";
import { getExtension, getFileKind, tabLabel } from "@/lib";
import { useClipboardStore, usePromptStore } from "@/modules";
import type {
  ContextMenuItem,
  ConversionItemDraft,
  ConversionMediaKind,
  ConversionModalRequest,
  EntryContextTarget,
  FileEntry,
} from "@/types";

type UseEntryMenuItemsOptions = {
  target: EntryContextTarget | null;
  selected: Set<string>;
  entryByPath: Map<string, FileEntry>;
  parentPath: string | null;
  currentPath: string;
  onOpenEntry: (path: string) => void;
  onOpenDir: (path: string) => void;
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

type ConvertibleSelectionKind = ConversionMediaKind;

const buildConvertItems = (
  quickKind: ConvertibleSelectionKind,
  extensions: readonly string[],
  currentExtension: string | null,
  requestBase: ConversionModalRequest,
  onOpenConvertModal: (request: ConversionModalRequest) => void,
  onQuickConvertImages: (request: ConversionModalRequest, targetFormat: string) => void,
): ContextMenuItem[] =>
  extensions
    .filter((extension) => extension !== currentExtension)
    .map((extension) => ({
      id: `entry-convert-${extension}`,
      label: CONVERT_FORMAT_LABELS[extension] ?? extension.toUpperCase(),
      onSelect: () => {
        const request = {
          ...requestBase,
          quickTargetFormat: extension,
          quickTargetKind: quickKind,
        };
        if (quickKind === "image") {
          onQuickConvertImages(request, extension);
          return;
        }
        onOpenConvertModal(request);
      },
    }));

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

const resolveMenuEntry = (
  path: string,
  target: EntryContextTarget,
  entryByPath: Map<string, FileEntry>,
) => {
  if (path === target.path) return target;
  return entryByPath.get(path) ?? null;
};

type SelectionSummary = {
  quickConvertKind: ConvertibleSelectionKind | null;
  canOpenConvertModal: boolean;
  sharedExtension: string | null;
  conversionRequest: ConversionModalRequest | null;
  hasVideo: boolean;
  hasMultiplePropertyTypes: boolean;
};

const summarizeSelection = (
  actionTargets: string[],
  target: EntryContextTarget,
  entryByPath: Map<string, FileEntry>,
): SelectionSummary => {
  let firstPropertyType: string | null = null;
  let hasMultiplePropertyTypes = false;
  let allConvertible = actionTargets.length > 0;
  let firstConvertKind: ConvertibleSelectionKind | null = null;
  let sameKindSelection = true;
  let sharedExtension: string | null = null;
  let hasSharedExtension = false;
  let hasVideo = false;
  const conversionItems: ConversionItemDraft[] = [];
  const sourceKindsSet = new Set<ConversionMediaKind>();

  // Single-pass scan keeps menu gating cheap even for large multi-selections.
  for (const path of actionTargets) {
    const entry = resolveMenuEntry(path, target, entryByPath);
    if (!entry) {
      allConvertible = false;
      continue;
    }

    const extension = entry.isDir ? null : getExtension(entry.name);
    const propertyType = entry.isDir ? "directory" : `file:${extension ?? "<none>"}`;
    if (!firstPropertyType) {
      firstPropertyType = propertyType;
    } else if (firstPropertyType !== propertyType) {
      hasMultiplePropertyTypes = true;
    }

    if (entry.isDir) {
      allConvertible = false;
      continue;
    }

    const fileKind = getFileKind(entry.name);
    if (fileKind !== "image" && fileKind !== "video") {
      allConvertible = false;
      continue;
    }
    const kind: ConversionMediaKind = fileKind;
    if (!firstConvertKind) {
      firstConvertKind = kind;
    } else if (firstConvertKind !== kind) {
      sameKindSelection = false;
    }
    if (kind === "video") hasVideo = true;
    sourceKindsSet.add(kind);

    if (!hasSharedExtension) {
      sharedExtension = extension;
      hasSharedExtension = true;
    } else if (sharedExtension !== extension) {
      sharedExtension = null;
    }

    conversionItems.push({
      path: entry.path,
      name: entry.name,
      kind,
      sourceExt: extension,
      override: null,
    });
  }

  const sourceKinds = Array.from(sourceKindsSet);
  const canOpenConvertModal = allConvertible && sourceKinds.length > 0;
  const quickConvertKind =
    allConvertible && sameKindSelection ? firstConvertKind : null;
  const conversionRequest: ConversionModalRequest | null = canOpenConvertModal
    ? {
        paths: conversionItems.map((item) => item.path),
        items: conversionItems,
        sourceKinds,
        quickTargetFormat: null,
        quickTargetKind: null,
      }
    : null;

  return {
    quickConvertKind,
    canOpenConvertModal,
    sharedExtension: canOpenConvertModal ? sharedExtension : null,
    conversionRequest,
    hasVideo,
    hasMultiplePropertyTypes,
  };
};

export const useEntryMenuItems = ({
  target,
  selected,
  entryByPath,
  parentPath,
  currentPath,
  onOpenEntry,
  onOpenDir,
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

  return useMemo<ContextMenuItem[]>(() => {
    if (!target) return [];
    const actionTargets = resolveContextTargets(target, selected, parentPath);
    const selectionSummary = summarizeSelection(actionTargets, target, entryByPath);
    const hasTargets = actionTargets.length > 0;
    const pasteTarget = (target.isDir ? target.path : currentPath).trim();
    const canPaste = Boolean(clipboard && clipboard.paths.length > 0 && pasteTarget);
    const quickConvertKind = selectionSummary.quickConvertKind;
    const conversionRequest = selectionSummary.conversionRequest;
    const canOpenConvertModal =
      menuShowConvert &&
      selectionSummary.canOpenConvertModal &&
      (!selectionSummary.hasVideo || ffmpegDetected);
    const canQuickConvert =
      menuShowConvert &&
      quickConvertKind !== null &&
      conversionRequest !== null &&
      (quickConvertKind === "image" || ffmpegDetected);
    const quickConvertItems =
      canQuickConvert && quickConvertKind && conversionRequest
      ? buildConvertItems(
          quickConvertKind,
          quickConvertKind === "video"
            ? VIDEO_CONVERT_EXTENSIONS
            : IMAGE_CONVERT_EXTENSIONS,
          selectionSummary.sharedExtension,
          conversionRequest,
          onOpenConvertModal,
          onQuickConvertImages,
        )
      : [];
    const quickConvertMenu =
      canQuickConvert && quickConvertItems.length > 0
        ? ({
            kind: "submenu",
            id: "entry-quick-convert",
            label: "Quick Convert",
            items: quickConvertItems,
          } as ContextMenuItem)
        : null;
    const openConvertItem =
      canOpenConvertModal && conversionRequest
        ? ({
            id: "entry-convert-open",
            label: "Convert...",
            onSelect: () => {
              onOpenConvertModal(conversionRequest);
            },
          } as ContextMenuItem)
        : null;
    const convertItems: ContextMenuItem[] = [];
    if (openConvertItem) convertItems.push(openConvertItem);
    if (quickConvertMenu) convertItems.push(quickConvertMenu);
    if (convertItems.length > 0) {
      convertItems.push({ kind: "divider", id: "entry-divider-convert" });
    }

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
      ...convertItems,
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
        hint: selectionSummary.hasMultiplePropertyTypes ? "Multiple types" : undefined,
        onSelect: () => {
          if (!hasTargets) return;
          void openPathProperties(actionTargets).catch((error) => {
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
    ffmpegDetected,
    menuShowConvert,
    onOpenConvertModal,
    onQuickConvertImages,
    onOpenDir,
    onOpenEntry,
    onPasteEntries,
    onRenameEntry,
    parentPath,
    selected,
    target,
    entryByPath,
  ]);
};
