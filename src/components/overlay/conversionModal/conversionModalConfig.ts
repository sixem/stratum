// Shared labels, dropdown groups, and small presentation helpers for the
// conversion modal feature folder.
import type { DropdownGroup } from "@/components/primitives";
import {
  CONVERT_FORMAT_LABELS,
  CONVERT_TARGET_GROUPS,
  VIDEO_CONVERT_PRESETS,
  VIDEO_QUALITY_RANGES,
  VIDEO_SPEED_LABELS,
  clampVideoQuality,
} from "@/constants";
import type {
  ConversionItemDraft,
  ConversionMediaKind,
  ConversionModalDraft,
  ConversionModalRequest,
  ConversionOutputMode,
  ConversionVideoEncoder,
  ConversionVideoFormat,
  ConversionVideoSpeed,
} from "@/types";

export const KIND_LABELS: Record<ConversionMediaKind, string> = {
  image: "Images",
  video: "Videos",
};

export const FORMAT_DETAIL_LABELS: Record<string, string> = {
  jpg: "Joint Photographic Experts Group (.jpg)",
  jpeg: "Joint Photographic Experts Group (.jpeg)",
  jfif: "JPEG File Interchange Format (.jfif)",
  png: "Portable Network Graphics (.png)",
  webp: "WebP image format (.webp)",
  gif: "Graphics Interchange Format (.gif)",
  bmp: "Bitmap image format (.bmp)",
  mp4: "MPEG-4 Part 14 container (.mp4)",
  webm: "WebM media container (.webm)",
  mkv: "Matroska media container (.mkv)",
  mov: "QuickTime movie container (.mov)",
  avi: "Audio Video Interleave container (.avi)",
};

export const RUN_PHASE_LABELS = {
  idle: "Ready",
  running: "Converting",
  completed: "Completed",
  failed: "Completed with issues",
} as const;

export const ITEM_STATUS_LABELS = {
  idle: "Ready",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  warning: "Warning",
} as const;

const MEDIA_KIND_PRIORITY: Record<ConversionMediaKind, number> = {
  video: 0,
  image: 1,
};

const flatFormatsByKind: Record<ConversionMediaKind, string[]> = {
  image: CONVERT_TARGET_GROUPS.image.flatMap((group) => group.formats),
  video: CONVERT_TARGET_GROUPS.video.flatMap((group) => group.formats),
};

export const ruleGroupsByKind: Record<ConversionMediaKind, DropdownGroup[]> = {
  image: CONVERT_TARGET_GROUPS.image.map((group) => ({
    id: group.id,
    label: group.label,
    options: group.formats.map((format) => ({
      value: format,
      label: CONVERT_FORMAT_LABELS[format] ?? format.toUpperCase(),
    })),
  })),
  video: CONVERT_TARGET_GROUPS.video.map((group) => ({
    id: group.id,
    label: group.label,
    options: group.formats.map((format) => ({
      value: format,
      label: CONVERT_FORMAT_LABELS[format] ?? format.toUpperCase(),
    })),
  })),
};

export const overrideGroupsByKind: Record<ConversionMediaKind, DropdownGroup[]> = {
  image: [
    {
      id: "image-overrides",
      options: flatFormatsByKind.image.map((format) => ({
        value: format,
        label: CONVERT_FORMAT_LABELS[format] ?? format.toUpperCase(),
      })),
    },
  ],
  video: [
    {
      id: "video-overrides",
      options: flatFormatsByKind.video.map((format) => ({
        value: format,
        label: CONVERT_FORMAT_LABELS[format] ?? format.toUpperCase(),
      })),
    },
  ],
};

export const videoPresetGroups: DropdownGroup[] = [
  {
    id: "video-presets",
    options: [
      { value: "custom", label: "Custom profile" },
      ...VIDEO_CONVERT_PRESETS.map((preset) => ({
        value: preset.id,
        label: preset.label,
      })),
    ],
  },
];

export const videoSpeedGroups: DropdownGroup[] = [
  {
    id: "video-speed",
    options: (Object.keys(VIDEO_SPEED_LABELS) as ConversionVideoSpeed[]).map(
      (speed) => ({
        value: speed,
        label: VIDEO_SPEED_LABELS[speed],
      }),
    ),
  },
];

export const findRuleFormat = (
  draft: ConversionModalDraft,
  kind: ConversionMediaKind,
) => {
  return draft.rules.find((rule) => rule.kind === kind)?.targetFormat ?? null;
};

export const asVideoFormat = (value: string | null): ConversionVideoFormat | null => {
  if (
    value === "mp4" ||
    value === "webm" ||
    value === "mkv" ||
    value === "mov" ||
    value === "avi"
  ) {
    return value;
  }
  return null;
};

export const buildValidationMessage = (
  request: ConversionModalRequest,
  draft: ConversionModalDraft,
) => {
  if (draft.outputMode === "create-new" && draft.suffix.trim().length === 0) {
    return "Suffix is required when using Create new output mode.";
  }
  for (const kind of request.sourceKinds) {
    const format = findRuleFormat(draft, kind);
    if (format) continue;
    return `Select a default target format for ${KIND_LABELS[kind].toLowerCase()}.`;
  }
  return null;
};

export const buildExampleName = (
  item: ConversionItemDraft,
  mode: ConversionOutputMode,
  suffix: string,
) => {
  const sourceExt = item.sourceExt ? `.${item.sourceExt}` : "";
  const baseName =
    sourceExt && item.name.endsWith(sourceExt)
      ? item.name.slice(0, -sourceExt.length)
      : item.name;
  if (mode === "replace") return item.name;
  return `${baseName}${suffix}${sourceExt}`;
};

export const formatQualityNormalized = (quality: number) => {
  const normalized = Math.min(100, Math.max(1, quality)) / 100;
  return normalized.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export const describeImageQuality = (quality: number) => {
  if (quality <= 35) return "Size-priority (stronger compression)";
  if (quality <= 70) return "Balanced output";
  if (quality <= 90) return "Detail-priority";
  return "Maximum detail / lowest PNG compression";
};

export const formatVideoQualityLabel = (encoder: ConversionVideoEncoder) => {
  return VIDEO_QUALITY_RANGES[encoder].label;
};

export const describeVideoQuality = (
  encoder: ConversionVideoEncoder,
  value: number,
) => {
  const normalized = clampVideoQuality(encoder, value);
  if (encoder === "libvpx-vp9") {
    if (normalized >= 34) return "Smaller files, softer detail";
    if (normalized >= 30) return "Balanced VP9 quality";
    return "Higher VP9 quality, larger files";
  }
  if (normalized >= 26) return "Smaller files, softer detail";
  if (normalized >= 21) return "Balanced H.264 quality";
  return "Higher H.264 quality, larger files";
};

export const sortConversionOverrideItems = (items: ConversionItemDraft[]) => {
  return [...items].sort((left, right) => {
    const kindDelta = MEDIA_KIND_PRIORITY[left.kind] - MEDIA_KIND_PRIORITY[right.kind];
    if (kindDelta !== 0) return kindDelta;
    return left.name.localeCompare(right.name);
  });
};

export const describeAppliedFormat = (appliedFormat: string | null) => {
  const label = appliedFormat
    ? CONVERT_FORMAT_LABELS[appliedFormat] ?? appliedFormat.toUpperCase()
    : "No format selected";
  const summary = appliedFormat ? `-> ${label}` : label;

  return {
    label,
    summary,
  };
};
