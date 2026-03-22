// Summarizes the active target list so menu builders can gate actions cheaply.

import { getExtension, getFileKind } from "@/lib";
import type {
  ConversionItemDraft,
  ConversionMediaKind,
  ConversionModalRequest,
  EntryContextTarget,
  FileEntry,
} from "@/types";
import { resolveMenuEntry } from "./shared";
import type {
  ConvertibleSelectionKind,
  EntryMenuSelectionSummary,
} from "./types";

export const summarizeEntrySelection = (
  actionTargets: string[],
  target: EntryContextTarget,
  entryByPath: Map<string, FileEntry>,
): EntryMenuSelectionSummary => {
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
