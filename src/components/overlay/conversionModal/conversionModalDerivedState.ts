// Pure derived-state builder for the conversion modal. Keeping presentation
// shaping here makes the hook smaller and lets future tests assert modal logic
// without rendering the whole dialog.
import type { DropdownGroup } from "@/components/primitives";
import {
  VIDEO_ENCODER_LABELS,
  VIDEO_QUALITY_RANGES,
  clampVideoQuality,
  getAllowedVideoEncoders,
  getVideoConvertPreset,
} from "@/constants";
import type {
  ConversionItemDraft,
  ConversionModalDraft,
  ConversionModalRequest,
  ConversionRunState,
  ConversionVideoEncoder,
} from "@/types";
import {
  asVideoFormat,
  describeImageQuality,
  describeVideoQuality,
  findRuleFormat,
  formatQualityNormalized,
  formatVideoQualityLabel,
} from "./conversionModalConfig";

const DEFAULT_VIDEO_ENCODERS: ConversionVideoEncoder[] = ["libx264"];

export type ConversionProgressTone =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "warning";

export type ConversionModalDerivedState = {
  activeMessage: string;
  hasImageItems: boolean;
  hasQuickPrefill: boolean;
  hasVideoItems: boolean;
  imageQualityLabel: string;
  primaryActionDisabled: boolean;
  primaryActionIntent: "convert" | "close";
  primaryActionLabel: string;
  progressTone: ConversionProgressTone;
  qualityNormalized: string;
  runInProgress: boolean;
  runPhase: ConversionRunState["phase"];
  sampleItem: ConversionItemDraft | null;
  secondaryActionLabel: string;
  selectedVideoPreset: ReturnType<typeof getVideoConvertPreset>;
  totalItems: number;
  validationMessage: string | null;
  videoEncoderGroups: DropdownGroup[];
  videoQualityHint: string | null;
  videoQualityLabel: string;
  videoQualityRange: (typeof VIDEO_QUALITY_RANGES)[ConversionVideoEncoder];
  videoQualityValue: number;
};

type BuildConversionModalDerivedStateParams = {
  request: ConversionModalRequest | null;
  draft: ConversionModalDraft | null;
  runState: ConversionRunState | null;
  imageQualityValue: number;
  videoQualityInputValue: number;
  validationMessage: string | null;
};

export const buildConversionModalDerivedState = ({
  request,
  draft,
  runState,
  imageQualityValue,
  videoQualityInputValue,
  validationMessage,
}: BuildConversionModalDerivedStateParams): ConversionModalDerivedState => {
  const selectedVideoFormat = asVideoFormat(draft ? findRuleFormat(draft, "video") : null);
  const availableVideoEncoders = selectedVideoFormat
    ? getAllowedVideoEncoders(selectedVideoFormat)
    : draft
      ? [draft.videoOptions.encoder]
      : DEFAULT_VIDEO_ENCODERS;
  const videoEncoderGroups: DropdownGroup[] = [
    {
      id: "video-encoder",
      options: availableVideoEncoders.map((encoder) => ({
        value: encoder,
        label: VIDEO_ENCODER_LABELS[encoder],
      })),
    },
  ];

  const selectedVideoPreset = draft
    ? getVideoConvertPreset(draft.videoOptions.presetId)
    : null;
  const videoQualityRange = draft
    ? VIDEO_QUALITY_RANGES[draft.videoOptions.encoder]
    : VIDEO_QUALITY_RANGES.libx264;
  const videoQualityLabel = draft
    ? formatVideoQualityLabel(draft.videoOptions.encoder)
    : "CRF";
  const videoQualityValue = draft
    ? clampVideoQuality(draft.videoOptions.encoder, videoQualityInputValue)
    : videoQualityInputValue;
  const videoQualityHint = draft
    ? describeVideoQuality(draft.videoOptions.encoder, videoQualityValue)
    : null;

  const runPhase = runState?.phase ?? "idle";
  const runInProgress = runPhase === "running";
  const queueFailed = runPhase === "failed";
  const queueCompleted = runPhase === "completed";
  const hasImageItems = request?.sourceKinds.includes("image") ?? false;
  const hasVideoItems = request?.sourceKinds.includes("video") ?? false;
  const totalItems = runState?.total ?? request?.items.length ?? 0;
  const hasQuickPrefill =
    Boolean(request?.quickTargetKind) && Boolean(request?.quickTargetFormat);
  const sampleItem = draft?.items[0] ?? null;
  const qualityNormalized = formatQualityNormalized(imageQualityValue);
  const imageQualityLabel = describeImageQuality(imageQualityValue);
  const itemCountLabel = `${totalItems} item${totalItems === 1 ? "" : "s"}`;
  const activeMessage = validationMessage
    ? validationMessage
    : runState?.message ??
      (queueCompleted
        ? `Queued ${itemCountLabel}`
        : queueFailed
          ? "Couldn't queue the current conversion request."
          : `Queues ${itemCountLabel}`);
  const progressTone: ConversionProgressTone =
    validationMessage && runPhase === "idle"
      ? "warning"
      : queueFailed
        ? "failed"
        : queueCompleted
          ? "completed"
          : runInProgress
            ? "running"
            : "idle";
  const primaryActionLabel = runInProgress
    ? "Queueing..."
    : queueCompleted
      ? "Dismiss"
      : queueFailed
        ? "Try again"
        : "Queue";
  const primaryActionDisabled =
    runInProgress || (!queueCompleted && Boolean(validationMessage));
  const secondaryActionLabel = queueFailed || queueCompleted
      ? "Close"
      : "Cancel";

  return {
    activeMessage,
    hasImageItems,
    hasQuickPrefill,
    hasVideoItems,
    imageQualityLabel,
    primaryActionDisabled,
    primaryActionIntent: queueCompleted ? "close" : "convert",
    primaryActionLabel,
    progressTone,
    qualityNormalized,
    runInProgress,
    runPhase,
    sampleItem,
    secondaryActionLabel,
    selectedVideoPreset,
    totalItems,
    validationMessage,
    videoEncoderGroups,
    videoQualityHint,
    videoQualityLabel,
    videoQualityRange,
    videoQualityValue,
  };
};
