// Builds file/folder context menu items for a targeted entry.
import { useMemo } from "react";
import {
  copyPathsToClipboard,
  openPathProperties,
  openPathWithDialog,
  openPathWithHandler,
} from "@/api";
import {
  CONVERT_FORMAT_LABELS,
  IMAGE_CONVERT_EXTENSIONS,
  VIDEO_CONVERT_EXTENSIONS,
} from "@/constants";
import { getExtension, getFileKind, tabLabel } from "@/lib";
import { useClipboardStore, usePromptStore, type PromptConfig } from "@/modules";
import type {
  ContextMenuItem,
  ConversionItemDraft,
  ConversionMediaKind,
  ConversionModalRequest,
  EntryContextTarget,
  FileEntry,
} from "@/types";
import { useOpenWithMenuState } from "./useOpenWithMenuState";

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

type OpenWithMenuState = ReturnType<typeof useOpenWithMenuState>;

type EntryMenuActions = {
  onOpenEntry: (path: string) => void;
  onOpenDir: (path: string) => void;
  onDeleteEntries: (paths: string[]) => Promise<{ deleted: number } | null>;
  onClearSelection: () => void;
  onRenameEntry: (target: EntryContextTarget) => void;
  onPasteEntries: (paths: string[], destination: string) => Promise<unknown> | void;
  onOpenConvertModal: (request: ConversionModalRequest) => void;
  onQuickConvertImages: (request: ConversionModalRequest, targetFormat: string) => void;
  showPrompt: (prompt: PromptConfig) => void;
};

// Compact context passed to pure menu-section builders.
type EntryMenuBuilderContext = {
  target: EntryContextTarget;
  actionTargets: string[];
  hasTargets: boolean;
  pasteTarget: string;
  canPaste: boolean;
  clipboardPaths: string[];
  selectionSummary: SelectionSummary;
  openWithMenuState: OpenWithMenuState;
  confirmDelete: boolean;
  ffmpegDetected: boolean;
  menuShowConvert: boolean;
  actions: EntryMenuActions;
};

const resolveActionError = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const buildQuickConvertItems = (
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

const buildOpenItem = ({
  target,
  hasTargets,
  actions,
}: EntryMenuBuilderContext): ContextMenuItem => ({
  id: "entry-open",
  label: "Open",
  onSelect: () => {
    if (!hasTargets) return;
    if (target.isDir) {
      actions.onOpenDir(target.path);
      return;
    }
    actions.onOpenEntry(target.path);
  },
  disabled: !hasTargets,
});

const buildOpenWithItems = ({
  target,
  openWithMenuState,
  actions,
}: EntryMenuBuilderContext): ContextMenuItem[] => {
  const showOpenWith = !target.isDir && Boolean(openWithMenuState.targetPath);
  if (!showOpenWith) return [];

  const openWithMenuItems: ContextMenuItem[] = [];
  if (openWithMenuState.status === "loading") {
    openWithMenuItems.push({
      id: "entry-open-with-loading",
      label: "Loading apps...",
      onSelect: () => undefined,
      disabled: true,
    });
  } else if (openWithMenuState.status === "error") {
    openWithMenuItems.push({
      id: "entry-open-with-error",
      label: "Couldn't load apps",
      onSelect: () => undefined,
      disabled: true,
    });
  } else if (openWithMenuState.handlers.length === 0) {
    openWithMenuItems.push({
      id: "entry-open-with-empty",
      label: "No apps found",
      onSelect: () => undefined,
      disabled: true,
    });
  } else {
    openWithMenuItems.push(
      ...openWithMenuState.handlers.map((handler) => ({
        id: `entry-open-with-${handler.id}`,
        label: handler.label,
        onSelect: () => {
          if (!openWithMenuState.targetPath) return;
          void openPathWithHandler(openWithMenuState.targetPath, handler.id).catch(
            (error) => {
              actions.showPrompt({
                title: "Couldn't open with this app",
                content: resolveActionError(
                  error,
                  "Unable to open this file with the selected app.",
                ),
                confirmLabel: "OK",
                cancelLabel: null,
              });
            },
          );
        },
      })),
    );
  }

  openWithMenuItems.push({ kind: "divider", id: "entry-open-with-divider-choose" });
  openWithMenuItems.push({
    id: "entry-open-with-choose",
    label: "Choose...",
    icon: "open-external",
    onSelect: () => {
      if (!openWithMenuState.targetPath) return;
      void openPathWithDialog(openWithMenuState.targetPath).catch((error) => {
        actions.showPrompt({
          title: "Couldn't open Open With",
          content: resolveActionError(
            error,
            "Unable to open the system Open With dialog.",
          ),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      });
    },
  });

  return [
    {
      kind: "submenu",
      id: "entry-open-with",
      label: "Open with",
      items: openWithMenuItems,
    },
  ];
};

const buildConvertItems = ({
  selectionSummary,
  ffmpegDetected,
  menuShowConvert,
  actions,
}: EntryMenuBuilderContext): ContextMenuItem[] => {
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
      ? buildQuickConvertItems(
          quickConvertKind,
          quickConvertKind === "video"
            ? VIDEO_CONVERT_EXTENSIONS
            : IMAGE_CONVERT_EXTENSIONS,
          selectionSummary.sharedExtension,
          conversionRequest,
          actions.onOpenConvertModal,
          actions.onQuickConvertImages,
        )
      : [];
  const quickConvertMenu =
    canQuickConvert && quickConvertItems.length > 0
      ? ({
          kind: "submenu",
          id: "entry-quick-convert",
          label: "Quick Convert",
          icon: "quick-convert",
          items: quickConvertItems,
        } as ContextMenuItem)
      : null;
  const openConvertItem =
    canOpenConvertModal && conversionRequest
      ? ({
          id: "entry-convert-open",
          label: "Convert...",
          icon: "convert",
          onSelect: () => {
            actions.onOpenConvertModal(conversionRequest);
          },
        } as ContextMenuItem)
      : null;

  const convertItems: ContextMenuItem[] = [];
  if (openConvertItem) convertItems.push(openConvertItem);
  if (quickConvertMenu) convertItems.push(quickConvertMenu);
  if (convertItems.length > 0) {
    convertItems.push({ kind: "divider", id: "entry-divider-convert" });
  }
  return convertItems;
};

const buildEditItems = ({
  target,
  actionTargets,
  hasTargets,
  pasteTarget,
  canPaste,
  clipboardPaths,
  confirmDelete,
  actions,
}: EntryMenuBuilderContext): ContextMenuItem[] => {
  const items: ContextMenuItem[] = [
    {
      id: "entry-copy",
      label: "Copy",
      icon: "copy",
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
        actions.onRenameEntry(target);
      },
      disabled: !hasTargets,
    },
  ];

  if (target.isDir || canPaste) {
    items.push({
      id: "entry-paste",
      label: target.isDir ? "Paste into folder" : "Paste",
      onSelect: () => {
        if (clipboardPaths.length === 0) return;
        if (!pasteTarget) return;
        void actions.onPasteEntries(clipboardPaths, pasteTarget);
      },
      disabled: !canPaste,
    });
  }

  items.push({
    id: "entry-delete",
    label: "Delete",
    icon: "delete",
    onSelect: () => {
      if (!hasTargets) return;
      const count = actionTargets.length;
      const label = count === 1 ? tabLabel(actionTargets[0] ?? "") : `${count} items`;
      const runDelete = () => {
        void Promise.resolve(actions.onDeleteEntries(actionTargets)).then((report) => {
          if (report?.deleted) {
            actions.onClearSelection();
          }
        });
      };
      if (!confirmDelete) {
        runDelete();
        return;
      }
      actions.showPrompt({
        title: count === 1 ? "Delete item?" : "Delete items?",
        content: `Delete ${label}? You can undo with Ctrl+Z.`,
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        onConfirm: runDelete,
      });
    },
    disabled: !hasTargets,
  });

  return items;
};

const buildPropertiesItems = ({
  actionTargets,
  hasTargets,
  selectionSummary,
  actions,
}: EntryMenuBuilderContext): ContextMenuItem[] => [
  { kind: "divider", id: "entry-divider-properties" },
  {
    id: "entry-properties",
    label: "Properties",
    hint: selectionSummary.hasMultiplePropertyTypes ? "Multiple types" : undefined,
    onSelect: () => {
      if (!hasTargets) return;
      void openPathProperties(actionTargets).catch((error) => {
        actions.showPrompt({
          title: "Couldn't open properties",
          content: resolveActionError(error, "Unable to open the properties dialog."),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      });
    },
    disabled: !hasTargets,
  },
];

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
  const openWithMenuState = useOpenWithMenuState(target);

  return useMemo<ContextMenuItem[]>(() => {
    if (!target) return [];
    const actionTargets = resolveContextTargets(target, selected, parentPath);
    const selectionSummary = summarizeSelection(actionTargets, target, entryByPath);
    const hasTargets = actionTargets.length > 0;
    const pasteTarget = (target.isDir ? target.path : currentPath).trim();
    const clipboardPaths = clipboard?.paths ?? [];
    const canPaste = Boolean(clipboardPaths.length > 0 && pasteTarget);
    const actions: EntryMenuActions = {
      onOpenEntry,
      onOpenDir,
      onDeleteEntries,
      onClearSelection,
      onRenameEntry,
      onPasteEntries,
      onOpenConvertModal,
      onQuickConvertImages,
      showPrompt: usePromptStore.getState().showPrompt,
    };
    const builderContext: EntryMenuBuilderContext = {
      target,
      actionTargets,
      hasTargets,
      pasteTarget,
      canPaste,
      clipboardPaths,
      selectionSummary,
      openWithMenuState,
      confirmDelete,
      ffmpegDetected,
      menuShowConvert,
      actions,
    };

    return [
      buildOpenItem(builderContext),
      ...buildOpenWithItems(builderContext),
      ...buildConvertItems(builderContext),
      ...buildEditItems(builderContext),
      ...buildPropertiesItems(builderContext),
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
    openWithMenuState.handlers,
    openWithMenuState.status,
    openWithMenuState.targetPath,
    parentPath,
    selected,
    target,
    entryByPath,
  ]);
};
