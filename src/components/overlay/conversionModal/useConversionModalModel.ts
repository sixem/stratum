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

  const updateImageOptions = useCallback(
    (updater: (imageOptions: ConversionModalDraft["imageOptions"]) => ConversionModalDraft["imageOptions"]) => {
      const currentDraft = draftRef.current;
      if (!currentDraft) return;
      updateDraft({
        ...currentDraft,
        imageOptions: updater(currentDraft.imageOptions),
      });
    },
    [updateDraft],
  );

  const updateRules = useCallback(
    (updater: (rules: ConversionModalDraft["rules"]) => ConversionModalDraft["rules"]) => {
      const currentDraft = draftRef.current;
      if (!currentDraft) return;
      updateDraft({
        ...currentDraft,
        rules: updater(currentDraft.rules),
      });
    },
    [updateDraft],
  );

  const updateVideoOptions = useCallback(
    (
      updater: (
        videoOptions: ConversionModalDraft["videoOptions"],
      ) => ConversionModalDraft["videoOptions"],
      options?: {
        rules?: (
          rules: ConversionModalDraft["rules"],
          nextVideoOptions: ConversionModalDraft["videoOptions"],
        ) => ConversionModalDraft["rules"];
      },
    ) => {
      const currentDraft = draftRef.current;
      if (!currentDraft) return;
      const nextVideoOptions = updater(currentDraft.videoOptions);
      updateDraft({
        ...currentDraft,
        videoOptions: nextVideoOptions,
        rules: options?.rules
          ? options.rules(currentDraft.rules, nextVideoOptions)
          : currentDraft.rules,
      });
    },
    [updateDraft],
  );

  const updateItemOverride = useCallback(
    (itemPath: string, targetFormat: string | null) => {
      const currentDraft = draftRef.current;
      if (!currentDraft) return;
      updateDraft({
        ...currentDraft,
        items: currentDraft.items.map((item) =>
          item.path === itemPath
            ? {
                ...item,
                override: targetFormat ? { targetFormat, presetId: null } : null,
              }
            : item,
        ),
      });
    },
    [updateDraft],
  );

  const markVideoRuleCustom = useCallback(
    (rules: ConversionModalDraft["rules"]) =>
      rules.map((rule) =>
        rule.kind === "video" ? { ...rule, presetId: "custom" } : rule,
      ),
    [],
  );

  const syncVideoRule = useCallback(
    (
      rules: ConversionModalDraft["rules"],
      patch: Partial<ConversionModalDraft["rules"][number]>,
    ) =>
      rules.map((rule) =>
        rule.kind === "video"
          ? {
              ...rule,
              ...patch,
            }
          : rule,
      ),
    [],
  );

  const commitImageQuality = useCallback(
    (quality: number) => {
      const clamped = Math.min(100, Math.max(1, Math.round(quality)));
      updateImageOptions((imageOptions) => ({
        ...imageOptions,
        quality: clamped,
      }));
    },
    [updateImageOptions],
  );

  const commitVideoQuality = useCallback(
    (value: number) => {
      updateVideoOptions(
        (videoOptions) => {
          const clamped = clampVideoQuality(videoOptions.encoder, value);
          return {
            ...videoOptions,
            presetId: "custom",
            quality: clamped,
          };
        },
        {
          rules: (rules) => markVideoRuleCustom(rules),
        },
      );
    },
    [markVideoRuleCustom, updateVideoOptions],
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

      if (kind !== "video") {
        updateRules((rules) =>
          rules.map((rule) =>
            rule.kind === kind
              ? {
                  ...rule,
                  targetFormat,
                  presetId: rule.presetId ?? null,
                }
              : rule,
          ),
        );
        return;
      }

      updateVideoOptions(
        (videoOptions) => {
          const videoFormat = asVideoFormat(targetFormat);
          const nextEncoder = videoFormat
            ? resolveVideoEncoderForFormat(videoFormat, videoOptions.encoder)
            : videoOptions.encoder;
          return {
            ...videoOptions,
            presetId: "custom",
            encoder: nextEncoder,
            quality: clampVideoQuality(nextEncoder, videoOptions.quality),
          };
        },
        {
          rules: (rules, nextVideoOptions) =>
            rules.map((rule) =>
              rule.kind === kind
                ? {
                    ...rule,
                    targetFormat,
                    presetId: nextVideoOptions.presetId,
                  }
                : rule,
            ),
        },
      );
    },
    [draft, updateRules, updateVideoOptions],
  );

  const setItemOverrideFormat = useCallback(
    (itemPath: string, targetFormat: string | null) => {
      if (!draft) return;
      updateItemOverride(itemPath, targetFormat);
    },
    [draft, updateItemOverride],
  );

  const handleOverrideTargetSelect = useCallback((itemPath: string) => {
    setExpandedOverridePath((current) => (current === itemPath ? null : itemPath));
  }, []);

  const setVideoPreset = useCallback(
    (presetValue: string | null) => {
      if (!draft || !presetValue) return;
      if (presetValue === "custom") {
        updateVideoOptions(
          (videoOptions) => ({
            ...videoOptions,
            presetId: "custom",
          }),
          {
            rules: (rules) => markVideoRuleCustom(rules),
          },
        );
        return;
      }

      const preset = getVideoConvertPreset(presetValue);
      if (!preset) return;

      updateVideoOptions(
        () => ({
          presetId: preset.id,
          encoder: preset.encoder,
          speed: preset.speed,
          quality: preset.quality,
          audioEnabled: preset.audioEnabled,
        }),
        {
          rules: (rules) =>
            syncVideoRule(rules, {
              targetFormat: preset.format,
              presetId: preset.id,
            }),
        },
      );
    },
    [draft, markVideoRuleCustom, syncVideoRule, updateVideoOptions],
  );

  const setVideoEncoder = useCallback(
    (encoderValue: string | null) => {
      if (!draft || !encoderValue) return;
      const requestedEncoder = encoderValue as ConversionVideoEncoder;
      updateVideoOptions(
        (videoOptions) => {
          const nextEncoder = selectedVideoFormat
            ? resolveVideoEncoderForFormat(selectedVideoFormat, requestedEncoder)
            : requestedEncoder;
          return {
            ...videoOptions,
            presetId: "custom",
            encoder: nextEncoder,
            quality: clampVideoQuality(nextEncoder, videoOptions.quality),
          };
        },
        {
          rules: (rules) => markVideoRuleCustom(rules),
        },
      );
    },
    [draft, markVideoRuleCustom, selectedVideoFormat, updateVideoOptions],
  );

  const setVideoSpeed = useCallback(
    (speedValue: string | null) => {
      if (!draft || !speedValue) return;
      updateVideoOptions(
        (videoOptions) => ({
          ...videoOptions,
          presetId: "custom",
          speed: speedValue as ConversionVideoSpeed,
        }),
        {
          rules: (rules) => markVideoRuleCustom(rules),
        },
      );
    },
    [draft, markVideoRuleCustom, updateVideoOptions],
  );

  const toggleVideoAudio = useCallback(() => {
    if (!draft) return;
    updateVideoOptions(
      (videoOptions) => ({
        ...videoOptions,
        presetId: "custom",
        audioEnabled: !videoOptions.audioEnabled,
      }),
      {
        rules: (rules) => markVideoRuleCustom(rules),
      },
    );
  }, [draft, markVideoRuleCustom, updateVideoOptions]);

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
