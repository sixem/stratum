// Shared video conversion option types for ffmpeg-backed conversions.
import type {
  ConversionVideoEncoder,
  ConversionVideoFormat,
  ConversionVideoSpeed,
} from "./conversion";

export type VideoConvertOptions = {
  format: ConversionVideoFormat;
  encoder: ConversionVideoEncoder;
  speed: ConversionVideoSpeed;
  quality: number;
  audioEnabled?: boolean | null;
  overwrite?: boolean | null;
  ffmpegPath?: string | null;
};
