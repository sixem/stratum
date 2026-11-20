// Conversion modal draft/run helpers shared by the App conversion controller.
import { DEFAULT_VIDEO_CONVERT_PRESET_ID, getVideoConvertPreset } from "../../../../constants/convert.ts";
import type {
  ConversionVideoFormat,
  ConversionItemRunStatus,
  ConversionModalDraft,
  ConversionModalRequest,
  ConversionRunState,
  ConversionRuleDraft,
  ImageTargetFormat,
} from "@/types";

export const DEFAULT_CONVERSION_SUFFIX = "_converted";
export const DEFAULT_CONVERSION_MESSAGE: string | null = null;

export type ImageTargetSpec = {
  format: ImageTargetFormat;
  extension: string;
  supportsQuality: boolean;
};

export type VideoTargetSpec = {
  format: ConversionVideoFormat;
  extension: string;
};

export const resolveImageTargetSpec = (format: string): ImageTargetSpec | null => {
  switch (format) {
    case "jpg":
      return { format: "jpeg", extension: "jpg", supportsQuality: true };
    case "jpeg":
      return { format: "jpeg", extension: "jpeg", supportsQuality: true };
    case "jfif":
      return { format: "jpeg", extension: "jfif", supportsQuality: true };
    case "png":
      return { format: "png", extension: "png", supportsQuality: true };
    case "webp":
      return { format: "webp", extension: "webp", supportsQuality: false };
    case "gif":
      return { format: "gif", extension: "gif", supportsQuality: false };
    case "bmp":
      return { format: "bmp", extension: "bmp", supportsQuality: false };
    default:
      return null;
  }
};

export const resolveVideoTargetSpec = (format: string): VideoTargetSpec | null => {
  switch (format) {
    case "mp4":
      return { format: "mp4", extension: "mp4" };
    case "webm":
      return { format: "webm", extension: "webm" };
    case "mkv":
      return { format: "mkv", extension: "mkv" };
    case "mov":
      return { format: "mov", extension: "mov" };
    case "avi":
      return { format: "avi", extension: "avi" };
    default:
      return null;
  }
};

export const buildConversionRunState = (
  request: ConversionModalRequest,
  patch?: Partial<ConversionRunState>,
): ConversionRunState => {
  const itemStatusByPath = request.items.reduce<Record<string, ConversionItemRunStatus>>(
    (result, item) => {
      result[item.path] = "idle";
      return result;
    },
    {},
  );
  const itemMessageByPath = request.items.reduce<Record<string, string | null>>(
    (result, item) => {
      result[item.path] = null;
      return result;
    },
    {},
  );
  return {
    phase: "idle",
    message: DEFAULT_CONVERSION_MESSAGE,
    total: request.items.length,
    processed: 0,
    completed: 0,
    failed: 0,
    itemStatusByPath,
    itemMessageByPath,
    transferJobId: null,
    ...patch,
  };
};

const buildConversionRuleDrafts = (request: ConversionModalRequest, presetId: ConversionModalDraft["videoOptions"]["presetId"]): ConversionRuleDraft[] => {
  return request.sourceKinds.map((kind) => ({
    kind,
    targetFormat:
      request.quickTargetKind === kind
        ? request.quickTargetFormat
        : kind === "video"
          ? "mp4"
          : null,
    presetId: kind === "video" ? presetId : null,
  }));
};

export const buildConversionModalDraft = (request: ConversionModalRequest): ConversionModalDraft => {
  const quickVideoFormat = request.quickTargetKind === "video" ? request.quickTargetFormat : null;
  // AVI has no named profile. Its supported encoder uses the standard H.264 defaults.
  const preset = getVideoConvertPreset(quickVideoFormat ? `${quickVideoFormat}_balanced` : DEFAULT_VIDEO_CONVERT_PRESET_ID);
  const presetId = preset?.id ?? "custom";
  return {
    outputMode: request.sourceKinds.includes("video") ? "create-new" : "replace",
    suffix: DEFAULT_CONVERSION_SUFFIX,
    imageOptions: {
      quality: 84,
    },
    videoOptions: {
      presetId,
      encoder: preset?.encoder ?? "libx264",
      speed: preset?.speed ?? "balanced",
      quality: preset?.quality ?? 20,
      audioEnabled: preset?.audioEnabled ?? true,
    },
    rules: buildConversionRuleDrafts(request, presetId),
    items: request.items.map((item) => ({
      ...item,
      override: item.override ?? null,
    })),
  };
};
