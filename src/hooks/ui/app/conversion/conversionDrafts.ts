// Conversion modal draft/run helpers shared by the App conversion controller.
import { DEFAULT_VIDEO_CONVERT_PRESET_ID, getVideoConvertPreset } from "@/constants";
import { normalizePath } from "@/lib";
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

export const toPathKey = (path: string) => normalizePath(path) ?? path.trim().toLowerCase();

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

const buildConversionRuleDrafts = (request: ConversionModalRequest): ConversionRuleDraft[] => {
  const defaultVideoPreset = getVideoConvertPreset(DEFAULT_VIDEO_CONVERT_PRESET_ID);
  return request.sourceKinds.map((kind) => ({
    kind,
    targetFormat:
      request.quickTargetKind === kind
        ? request.quickTargetFormat
        : kind === "video"
          ? defaultVideoPreset?.format ?? null
          : null,
    presetId: kind === "video" ? defaultVideoPreset?.id ?? null : null,
  }));
};

export const buildConversionModalDraft = (request: ConversionModalRequest): ConversionModalDraft => {
  const defaultVideoPreset = getVideoConvertPreset(DEFAULT_VIDEO_CONVERT_PRESET_ID);
  return {
    outputMode: "replace",
    suffix: DEFAULT_CONVERSION_SUFFIX,
    imageOptions: {
      quality: 84,
    },
    videoOptions: {
      presetId: defaultVideoPreset?.id ?? DEFAULT_VIDEO_CONVERT_PRESET_ID,
      encoder: defaultVideoPreset?.encoder ?? "libx264",
      speed: defaultVideoPreset?.speed ?? "balanced",
      quality: defaultVideoPreset?.quality ?? 20,
      audioEnabled: defaultVideoPreset?.audioEnabled ?? true,
    },
    rules: buildConversionRuleDrafts(request),
    items: request.items.map((item) => ({
      ...item,
      override: item.override ?? null,
    })),
  };
};
