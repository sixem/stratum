// Builds conversion actions from the summarized selection state.

import {
  CONVERT_FORMAT_LABELS,
  IMAGE_CONVERT_EXTENSIONS,
  VIDEO_CONVERT_EXTENSIONS,
} from "@/constants";
import type {
  ContextMenuItem,
  ConversionModalRequest,
} from "@/types";
import type {
  ConvertibleSelectionKind,
  EntryMenuSelectionSummary,
} from "./types";

type BuildEntryConvertItemsOptions = {
  selectionSummary: EntryMenuSelectionSummary;
  ffmpegDetected: boolean;
  menuShowConvert: boolean;
  onOpenConvertModal: (request: ConversionModalRequest) => void;
  onQuickConvertImages: (
    request: ConversionModalRequest,
    targetFormat: string,
  ) => void;
};

const buildQuickConvertItems = (
  quickKind: ConvertibleSelectionKind,
  extensions: readonly string[],
  currentExtension: string | null,
  requestBase: ConversionModalRequest,
  onOpenConvertModal: (request: ConversionModalRequest) => void,
  onQuickConvertImages: (
    request: ConversionModalRequest,
    targetFormat: string,
  ) => void,
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

export const buildEntryConvertItems = ({
  selectionSummary,
  ffmpegDetected,
  menuShowConvert,
  onOpenConvertModal,
  onQuickConvertImages,
}: BuildEntryConvertItemsOptions): ContextMenuItem[] => {
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
          onOpenConvertModal,
          onQuickConvertImages,
        )
      : [];

  const convertItems: ContextMenuItem[] = [];

  if (canOpenConvertModal && conversionRequest) {
    convertItems.push({
      id: "entry-convert-open",
      label: "Convert...",
      icon: "convert",
      onSelect: () => {
        onOpenConvertModal(conversionRequest);
      },
    });
  }

  if (canQuickConvert && quickConvertItems.length > 0) {
    convertItems.push({
      kind: "submenu",
      id: "entry-quick-convert",
      label: "Quick Convert",
      icon: "quick-convert",
      items: quickConvertItems,
    });
  }

  if (convertItems.length > 0) {
    convertItems.push({ kind: "divider", id: "entry-divider-convert" });
  }

  return convertItems;
};
