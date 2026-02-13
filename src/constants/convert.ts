// Supported conversion targets for media files.
import type {
  ConversionMediaKind,
  ConversionVideoEncoder,
  ConversionVideoFormat,
  ConversionVideoPresetId,
  ConversionVideoSpeed,
} from "@/types";

export const IMAGE_CONVERT_EXTENSIONS = [
  "jpg",
  "jpeg",
  "jfif",
  "png",
  "webp",
  "gif",
  "bmp",
] as const;

export const VIDEO_CONVERT_EXTENSIONS = ["mp4", "webm", "mkv", "mov", "avi"] as const;

export const CONVERT_FORMAT_LABELS: Record<string, string> = {
  jpg: "JPG",
  jpeg: "JPEG",
  jfif: "JFIF",
  png: "PNG",
  webp: "WebP",
  gif: "GIF",
  bmp: "BMP",
  mp4: "MP4",
  webm: "WebM",
  mkv: "MKV",
  mov: "MOV",
  avi: "AVI",
};

export type ConvertTargetGroup = {
  id: string;
  label: string;
  formats: readonly string[];
};

export const CONVERT_TARGET_GROUPS: Record<ConversionMediaKind, ConvertTargetGroup[]> = {
  image: [
    {
      id: "image-common",
      label: "Common",
      formats: ["png", "jpg", "jpeg", "webp"],
    },
    {
      id: "image-other",
      label: "Other",
      formats: ["jfif", "gif", "bmp"],
    },
  ],
  video: [
    {
      id: "video-common",
      label: "Common",
      formats: ["mp4", "webm", "mkv"],
    },
    {
      id: "video-other",
      label: "Other",
      formats: ["mov", "avi"],
    },
  ],
};

export const QUICK_CONVERT_PRESET_LABELS: Record<string, string> = {
  jpg: "Quick convert to JPG",
  jpeg: "Quick convert to JPEG",
  jfif: "Quick convert to JFIF",
  png: "Quick convert to PNG",
  webp: "Quick convert to WebP",
  gif: "Quick convert to GIF",
  bmp: "Quick convert to BMP",
  mp4: "Quick convert to MP4",
  webm: "Quick convert to WebM",
  mkv: "Quick convert to MKV",
  mov: "Quick convert to MOV",
  avi: "Quick convert to AVI",
};

export type ConversionVideoPreset = {
  id: Exclude<ConversionVideoPresetId, "custom">;
  label: string;
  description: string;
  format: ConversionVideoFormat;
  encoder: ConversionVideoEncoder;
  speed: ConversionVideoSpeed;
  quality: number;
  audioEnabled: boolean;
};

export const VIDEO_ENCODER_LABELS: Record<ConversionVideoEncoder, string> = {
  libx264: "H.264 (x264)",
  "libvpx-vp9": "VP9 (libvpx)",
};

export const VIDEO_SPEED_LABELS: Record<ConversionVideoSpeed, string> = {
  fast: "Fast",
  balanced: "Balanced",
  quality: "Quality",
};

export const VIDEO_ENCODERS_BY_FORMAT: Record<ConversionVideoFormat, readonly ConversionVideoEncoder[]> = {
  mp4: ["libx264"],
  mov: ["libx264"],
  avi: ["libx264"],
  webm: ["libvpx-vp9"],
  mkv: ["libx264", "libvpx-vp9"],
};

export const VIDEO_QUALITY_RANGES: Record<
  ConversionVideoEncoder,
  { min: number; max: number; step: number; defaultValue: number; label: string }
> = {
  libx264: { min: 16, max: 30, step: 1, defaultValue: 20, label: "CRF" },
  "libvpx-vp9": { min: 18, max: 36, step: 1, defaultValue: 32, label: "CRF" },
};

const buildX264Preset = (
  id: Exclude<ConversionVideoPresetId, "custom">,
  format: ConversionVideoFormat,
  label: string,
  speed: ConversionVideoSpeed,
  quality: number,
  description: string,
): ConversionVideoPreset => ({
  id,
  label,
  description,
  format,
  encoder: "libx264",
  speed,
  quality,
  audioEnabled: true,
});

const buildVp9Preset = (
  id: Exclude<ConversionVideoPresetId, "custom">,
  format: ConversionVideoFormat,
  label: string,
  speed: ConversionVideoSpeed,
  quality: number,
  description: string,
): ConversionVideoPreset => ({
  id,
  label,
  description,
  format,
  encoder: "libvpx-vp9",
  speed,
  quality,
  audioEnabled: true,
});

export const VIDEO_CONVERT_PRESETS: readonly ConversionVideoPreset[] = [
  buildX264Preset(
    "mp4_fast",
    "mp4",
    "Fast MP4",
    "fast",
    24,
    "Fastest export with larger files and softer detail.",
  ),
  buildX264Preset(
    "mp4_balanced",
    "mp4",
    "Balanced MP4",
    "balanced",
    20,
    "Good tradeoff between speed, size, and clarity.",
  ),
  buildX264Preset(
    "mp4_quality",
    "mp4",
    "Quality MP4",
    "quality",
    18,
    "Higher quality with slower encoding.",
  ),
  buildX264Preset(
    "mp4_small",
    "mp4",
    "Small MP4",
    "quality",
    28,
    "Smallest MP4 files with softer detail.",
  ),
  buildVp9Preset(
    "webm_fast",
    "webm",
    "Fast WebM",
    "fast",
    34,
    "Fast VP9 export with larger files.",
  ),
  buildVp9Preset(
    "webm_balanced",
    "webm",
    "Balanced WebM",
    "balanced",
    32,
    "Web-friendly VP9 export for most clips.",
  ),
  buildVp9Preset(
    "webm_quality",
    "webm",
    "Quality WebM",
    "quality",
    28,
    "Higher quality VP9 with slower encoding.",
  ),
  buildVp9Preset(
    "webm_small",
    "webm",
    "Small WebM",
    "quality",
    36,
    "Smallest WebM files for size limits.",
  ),
  buildX264Preset(
    "mkv_fast",
    "mkv",
    "Fast MKV",
    "fast",
    24,
    "Fast MKV export with wide container support.",
  ),
  buildX264Preset(
    "mkv_balanced",
    "mkv",
    "Balanced MKV",
    "balanced",
    20,
    "Balanced MKV for compatibility workflows.",
  ),
  buildX264Preset(
    "mkv_quality",
    "mkv",
    "Quality MKV",
    "quality",
    18,
    "Quality MKV with slower encoding.",
  ),
  buildX264Preset(
    "mkv_small",
    "mkv",
    "Small MKV",
    "quality",
    28,
    "Smallest MKV files with softer detail.",
  ),
  buildX264Preset(
    "mov_fast",
    "mov",
    "Fast MOV",
    "fast",
    24,
    "Fast MOV export for editor workflows.",
  ),
  buildX264Preset(
    "mov_balanced",
    "mov",
    "Balanced MOV",
    "balanced",
    20,
    "Balanced MOV for post workflows.",
  ),
  buildX264Preset(
    "mov_quality",
    "mov",
    "Quality MOV",
    "quality",
    18,
    "Quality MOV with slower encoding.",
  ),
  buildX264Preset(
    "mov_small",
    "mov",
    "Small MOV",
    "quality",
    28,
    "Smallest MOV files with softer detail.",
  ),
];

export const DEFAULT_VIDEO_CONVERT_PRESET_ID: ConversionVideoPresetId = "mp4_balanced";

export const getAllowedVideoEncoders = (format: ConversionVideoFormat): ConversionVideoEncoder[] => {
  const allowed = VIDEO_ENCODERS_BY_FORMAT[format];
  return allowed ? [...allowed] : ["libx264"];
};

export const resolveVideoEncoderForFormat = (
  format: ConversionVideoFormat,
  encoder: ConversionVideoEncoder,
): ConversionVideoEncoder => {
  const allowed = getAllowedVideoEncoders(format);
  return allowed.includes(encoder) ? encoder : (allowed[0] ?? "libx264");
};

export const getVideoConvertPreset = (presetId: ConversionVideoPresetId | string | null | undefined) => {
  if (!presetId || presetId === "custom") {
    return null;
  }
  return VIDEO_CONVERT_PRESETS.find((preset) => preset.id === presetId) ?? null;
};

export const clampVideoQuality = (
  encoder: ConversionVideoEncoder,
  value: number,
) => {
  const range = VIDEO_QUALITY_RANGES[encoder];
  if (!Number.isFinite(value)) {
    return range.defaultValue;
  }
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
};
