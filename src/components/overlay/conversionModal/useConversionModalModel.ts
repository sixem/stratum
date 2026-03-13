// Centralizes conversion modal state, derived values, and draft mutation
// handlers so the top-level modal component can stay mostly presentational.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  VIDEO_ENCODER_LABELS,
  VIDEO_QUALITY_RANGES,
  clampVideoQuality,
  getAllowedVideoEncoders,
  getVideoConvertPreset,
  resolveVideoEncoderForFormat,
} from "@/constants";
import type {
  ConversionItemDraft,
  ConversionMediaKind,
  ConversionModalDraft,
  ConversionModalRequest,
  ConversionOutputMode,
  ConversionRunState,
  ConversionVideoEncoder,
  ConversionVideoSpeed,
} from "@/types";
import {
  asVideoFormat,
  buildValidationMessage,
  describeImageQuality,
  describeVideoQuality,
  findRuleFormat,
  formatQualityNormalized,
  formatVideoQualityLabel,
  sortConversionOverrideItems,
} from "./conversionModalConfig";
import { useBufferedRangeValue } from "./useBufferedRangeValue";

type UseConversionModalModelParams = {
  open: boolean;
  request: ConversionModalRequest | null;
  draft: ConversionModalDraft | null;
  runState: ConversionRunState | null;
  onDraftChange: (draft: ConversionModalDraft) => void;
  onConvert: () => void;
  onClose: () => void;
};

type ConversionProgressTone = "idle" | "running" | "completed" | "failed" | "warning";

export const useConversionModalModel = ({
  open,
  request,
  draft,
  runState,
  onDraftChange,
  onConvert,
  onClose,
}: UseConversionModalModelParams) => {
  const draftRef = useRef<ConversionModalDraft | null>(draft);
  const overrideItemRefs = useRef(new Map<string, HTMLDivElement>());
  const [expandedOverridePath, setExpandedOverridePath] = useState<string | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const requestKey = request?.paths.join("|") ?? "";
  const sortedOverrideItems = useMemo(() => {
    if (!draft) return [] as ConversionItemDraft[];
    return sortConversionOverrideItems(draft.items);
  }, [draft]);
  const itemPathsKey = sortedOverrideItems.map((item) => item.path).join("|");

  useEffect(() => {
    if (!open || !draft) return;
    setExpandedOverridePath((current) => {
      if (current && sortedOverrideItems.some((item) => item.path === current)) {
        return current;
      }
      return null;
    });
  }, [draft, itemPathsKey, open, requestKey, sortedOverrideItems]);

  useEffect(() => {
    if (!open || !expandedOverridePath) return;
    const frame = window.requestAnimationFrame(() => {
      overrideItemRefs.current
        .get(expandedOverridePath)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedOverridePath, open]);

  const selectedVideoFormat = asVideoFormat(draft ? findRuleFormat(draft, "video") : null);
  const availableVideoEncoders = useMemo(() => {
    if (selectedVideoFormat) {
      const fromFormat = getAllowedVideoEncoders(selectedVideoFormat);
      if (fromFormat.length > 0) {
        return fromFormat;
      }
    }
    if (!draft) return ["libx264"] as ConversionVideoEncoder[];
    return [draft.videoOptions.encoder];
  }, [draft, selectedVideoFormat]);

  const videoEncoderGroups = useMemo(
    () => [
      {
        id: "video-encoder",
        options: availableVideoEncoders.map((encoder) => ({
          value: encoder,
          label: VIDEO_ENCODER_LABELS[encoder],
        })),
      },
    ],
    [availableVideoEncoders],
  );

  const selectedVideoPreset = draft ? getVideoConvertPreset(draft.videoOptions.presetId) : null;
  const videoQualityRange = draft
    ? VIDEO_QUALITY_RANGES[draft.videoOptions.encoder]
    : VIDEO_QUALITY_RANGES.libx264;
  const videoQualityLabel = draft
    ? formatVideoQualityLabel(draft.videoOptions.encoder)
    : "CRF";

  const updateDraft = useCallback(
    (next: ConversionModalDraft) => {
      draftRef.current = next;
      onDraftChange(next);
    },
    [onDraftChange],
  );

  const commitImageQuality = useCallback(
    (quality: number) => {
      const currentDraft = draftRef.current;
      if (!currentDraft) return;
      const clamped = Math.min(100, Math.max(1, Math.round(quality)));
      updateDraft({
        ...currentDraft,
        imageOptions: {
          ...currentDraft.imageOptions,
          quality: clamped,
        },
      });
    },
    [updateDraft],
  );

  const commitVideoQuality = useCallback(
    (value: number) => {
      const currentDraft = draftRef.current;
      if (!currentDraft) return;
      const clamped = clampVideoQuality(currentDraft.videoOptions.encoder, value);
      updateDraft({
        ...currentDraft,
        videoOptions: {
          ...currentDraft.videoOptions,
          presetId: "custom",
          quality: clamped,
        },
        rules: currentDraft.rules.map((rule) =>
          rule.kind === "video" ? { ...rule, presetId: "custom" } : rule,
        ),
      });
    },
    [updateDraft],
  );

  const imageQualityControl = useBufferedRangeValue(
    draft?.imageOptions.quality ?? 100,
    commitImageQuality,
  );
  const videoQualityControl = useBufferedRangeValue(
    draft?.videoOptions.quality ?? 23,
    commitVideoQuality,
  );

  const imageQualityValue = imageQualityControl.value;
  const videoQualityValue = draft
    ? clampVideoQuality(draft.videoOptions.encoder, videoQualityControl.value)
    : videoQualityControl.value;
  const videoQualityHint = draft
    ? describeVideoQuality(draft.videoOptions.encoder, videoQualityValue)
    : null;

  const setOutputMode = useCallback(
    (outputMode: ConversionOutputMode) => {
      if (!draft || draft.outputMode === outputMode) return;
      updateDraft({ ...draft, outputMode });
    },
    [draft, updateDraft],
  );

  const setSuffix = useCallback(
    (suffix: string) => {
      if (!draft) return;
      updateDraft({ ...draft, suffix });
    },
    [draft, updateDraft],
  );

  const setRuleFormat = useCallback(
    (kind: ConversionMediaKind, targetFormat: string | null) => {
      if (!draft) return;
      let nextVideoOptions = draft.videoOptions;
      if (kind === "video") {
        const videoFormat = asVideoFormat(targetFormat);
        const nextEncoder = videoFormat
          ? resolveVideoEncoderForFormat(videoFormat, draft.videoOptions.encoder)
          : draft.videoOptions.encoder;
        nextVideoOptions = {
          ...draft.videoOptions,
          presetId: "custom",
          encoder: nextEncoder,
          quality: clampVideoQuality(nextEncoder, draft.videoOptions.quality),
        };
      }
      updateDraft({
        ...draft,
        videoOptions: nextVideoOptions,
        rules: draft.rules.map((rule) =>
          rule.kind === kind
            ? {
                ...rule,
                targetFormat,
                presetId:
                  kind === "video"
                    ? nextVideoOptions.presetId
                    : rule.presetId ?? null,
              }
            : rule,
        ),
      });
    },
    [draft, updateDraft],
  );

  const setItemOverrideFormat = useCallback(
    (itemPath: string, targetFormat: string | null) => {
      if (!draft) return;
      updateDraft({
        ...draft,
        items: draft.items.map((item) =>
          item.path === itemPath
            ? {
                ...item,
                override: targetFormat ? { targetFormat, presetId: null } : null,
              }
            : item,
        ),
      });
    },
    [draft, updateDraft],
  );

  const handleOverrideTargetSelect = useCallback((itemPath: string) => {
    setExpandedOverridePath((current) => (current === itemPath ? null : itemPath));
  }, []);

  const setVideoPreset = useCallback(
    (presetValue: string | null) => {
      if (!draft || !presetValue) return;
      if (presetValue === "custom") {
        updateDraft({
          ...draft,
          videoOptions: {
            ...draft.videoOptions,
            presetId: "custom",
          },
          rules: draft.rules.map((rule) =>
            rule.kind === "video" ? { ...rule, presetId: "custom" } : rule,
          ),
        });
        return;
      }
      const preset = getVideoConvertPreset(presetValue);
      if (!preset) return;
      updateDraft({
        ...draft,
        videoOptions: {
          presetId: preset.id,
          encoder: preset.encoder,
          speed: preset.speed,
          quality: preset.quality,
          audioEnabled: preset.audioEnabled,
        },
        rules: draft.rules.map((rule) =>
          rule.kind === "video"
            ? {
                ...rule,
                targetFormat: preset.format,
                presetId: preset.id,
              }
            : rule,
        ),
      });
    },
    [draft, updateDraft],
  );

  const setVideoEncoder = useCallback(
    (encoderValue: string | null) => {
      if (!draft || !encoderValue) return;
      const requestedEncoder = encoderValue as ConversionVideoEncoder;
      const nextEncoder = selectedVideoFormat
        ? resolveVideoEncoderForFormat(selectedVideoFormat, requestedEncoder)
        : requestedEncoder;
      updateDraft({
        ...draft,
        videoOptions: {
          ...draft.videoOptions,
          presetId: "custom",
          encoder: nextEncoder,
          quality: clampVideoQuality(nextEncoder, draft.videoOptions.quality),
        },
        rules: draft.rules.map((rule) =>
          rule.kind === "video" ? { ...rule, presetId: "custom" } : rule,
        ),
      });
    },
    [draft, selectedVideoFormat, updateDraft],
  );

  const setVideoSpeed = useCallback(
    (speedValue: string | null) => {
      if (!draft || !speedValue) return;
      updateDraft({
        ...draft,
        videoOptions: {
          ...draft.videoOptions,
          presetId: "custom",
          speed: speedValue as ConversionVideoSpeed,
        },
        rules: draft.rules.map((rule) =>
          rule.kind === "video" ? { ...rule, presetId: "custom" } : rule,
        ),
      });
    },
    [draft, updateDraft],
  );

  const toggleVideoAudio = useCallback(() => {
    if (!draft) return;
    updateDraft({
      ...draft,
      videoOptions: {
        ...draft.videoOptions,
        presetId: "custom",
        audioEnabled: !draft.videoOptions.audioEnabled,
      },
      rules: draft.rules.map((rule) =>
        rule.kind === "video" ? { ...rule, presetId: "custom" } : rule,
      ),
    });
  }, [draft, updateDraft]);

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
  const videoCount = sortedOverrideItems.filter((item) => item.kind === "video").length;
  const imageCount = sortedOverrideItems.filter((item) => item.kind === "image").length;
  const qualityNormalized = formatQualityNormalized(imageQualityValue);
  const imageQualityLabel = describeImageQuality(imageQualityValue);
  const itemCountLabel = `${totalItems} item${totalItems === 1 ? "" : "s"}`;
  const validationMessage =
    request && draft ? buildValidationMessage(request, draft) : null;
  const activeMessage = validationMessage
    ? validationMessage
    : runState?.message ??
      (queueCompleted
        ? `Queued ${itemCountLabel}`
        : queueFailed
          ? "Couldn't queue the current conversion request."
          : `Queues ${itemCountLabel}`
      );
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
  const handlePrimaryAction = queueCompleted ? onClose : onConvert;
  const primaryActionDisabled = runInProgress || (queueCompleted ? false : Boolean(validationMessage));
  const secondaryActionLabel = runInProgress
    ? "Hide"
    : queueFailed || queueCompleted
      ? "Close"
      : "Cancel";

  return {
    activeMessage,
    expandedOverridePath,
    handleOverrideTargetSelect,
    handlePrimaryAction,
    hasImageItems,
    hasQuickPrefill,
    hasVideoItems,
    imageCount,
    imageQualityControl,
    imageQualityLabel,
    imageQualityValue,
    overrideItemRefs,
    primaryActionDisabled,
    primaryActionLabel,
    progressTone,
    qualityNormalized,
    runInProgress,
    runPhase,
    sampleItem,
    secondaryActionLabel,
    selectedVideoPreset,
    setItemOverrideFormat,
    setOutputMode,
    setRuleFormat,
    setSuffix,
    setVideoEncoder,
    setVideoPreset,
    setVideoSpeed,
    sortedOverrideItems,
    toggleVideoAudio,
    totalItems,
    validationMessage,
    videoCount,
    videoEncoderGroups,
    videoQualityControl,
    videoQualityHint,
    videoQualityLabel,
    videoQualityRange,
    videoQualityValue,
  };
};

export type ConversionModalModel = ReturnType<typeof useConversionModalModel>;
