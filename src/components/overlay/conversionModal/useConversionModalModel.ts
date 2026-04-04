// React-facing coordinator for the conversion modal. The hook keeps modal-only
// refs and effects local, while draft mutations and view shaping live in pure
// helpers beside it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversionMediaKind,
  ConversionModalDraft,
  ConversionModalRequest,
  ConversionOutputMode,
  ConversionRunState,
} from "@/types";
import { buildConversionModalDerivedState } from "./conversionModalDerivedState";
import {
  setConversionImageQuality,
  setConversionItemOverrideFormat,
  setConversionOutputMode,
  setConversionRuleFormat,
  setConversionSuffix,
  setConversionVideoEncoder,
  setConversionVideoPreset,
  setConversionVideoQuality,
  setConversionVideoSpeed,
  toggleConversionVideoAudio,
} from "./conversionModalDraftMutators";
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

  const commitDraftMutation = useCallback(
    (mutateDraft: (draftValue: ConversionModalDraft) => ConversionModalDraft) => {
      const currentDraft = draftRef.current;
      if (!currentDraft) return;

      const nextDraft = mutateDraft(currentDraft);
      if (nextDraft === currentDraft) {
        return;
      }

      draftRef.current = nextDraft;
      onDraftChange(nextDraft);
    },
    [onDraftChange],
  );

  const commitImageQuality = useCallback(
    (quality: number) => {
      commitDraftMutation((currentDraft) =>
        setConversionImageQuality(currentDraft, quality),
      );
    },
    [commitDraftMutation],
  );

  const commitVideoQuality = useCallback(
    (quality: number) => {
      commitDraftMutation((currentDraft) =>
        setConversionVideoQuality(currentDraft, quality),
      );
    },
    [commitDraftMutation],
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
  const derivedState = useMemo(
    () =>
      buildConversionModalDerivedState({
        request,
        draft,
        runState,
        imageQualityValue,
        videoQualityInputValue: videoQualityControl.value,
      }),
    [draft, imageQualityValue, request, runState, videoQualityControl.value],
  );
  const requestKey = request?.paths.join("|") ?? "";
  const itemPathsKey = derivedState.sortedOverrideItems.map((item) => item.path).join("|");

  useEffect(() => {
    if (!open || !draft) return;

    setExpandedOverridePath((current) => {
      if (
        current &&
        derivedState.sortedOverrideItems.some((item) => item.path === current)
      ) {
        return current;
      }
      return null;
    });
  }, [derivedState.sortedOverrideItems, draft, itemPathsKey, open, requestKey]);

  useEffect(() => {
    if (!open || !expandedOverridePath) return;

    const frame = window.requestAnimationFrame(() => {
      overrideItemRefs.current
        .get(expandedOverridePath)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [expandedOverridePath, open]);

  const setOutputMode = useCallback(
    (outputMode: ConversionOutputMode) => {
      commitDraftMutation((currentDraft) =>
        setConversionOutputMode(currentDraft, outputMode),
      );
    },
    [commitDraftMutation],
  );

  const setSuffix = useCallback(
    (suffix: string) => {
      commitDraftMutation((currentDraft) => setConversionSuffix(currentDraft, suffix));
    },
    [commitDraftMutation],
  );

  const setRuleFormat = useCallback(
    (kind: ConversionMediaKind, targetFormat: string | null) => {
      commitDraftMutation((currentDraft) =>
        setConversionRuleFormat(currentDraft, kind, targetFormat),
      );
    },
    [commitDraftMutation],
  );

  const setItemOverrideFormat = useCallback(
    (itemPath: string, targetFormat: string | null) => {
      commitDraftMutation((currentDraft) =>
        setConversionItemOverrideFormat(currentDraft, itemPath, targetFormat),
      );
    },
    [commitDraftMutation],
  );

  const handleOverrideTargetSelect = useCallback((itemPath: string) => {
    setExpandedOverridePath((current) => (current === itemPath ? null : itemPath));
  }, []);

  const setVideoPreset = useCallback(
    (presetValue: string | null) => {
      commitDraftMutation((currentDraft) =>
        setConversionVideoPreset(currentDraft, presetValue),
      );
    },
    [commitDraftMutation],
  );

  const setVideoEncoder = useCallback(
    (encoderValue: string | null) => {
      commitDraftMutation((currentDraft) =>
        setConversionVideoEncoder(currentDraft, encoderValue),
      );
    },
    [commitDraftMutation],
  );

  const setVideoSpeed = useCallback(
    (speedValue: string | null) => {
      commitDraftMutation((currentDraft) =>
        setConversionVideoSpeed(currentDraft, speedValue),
      );
    },
    [commitDraftMutation],
  );

  const toggleVideoAudio = useCallback(() => {
    commitDraftMutation((currentDraft) => toggleConversionVideoAudio(currentDraft));
  }, [commitDraftMutation]);

  const handlePrimaryAction =
    derivedState.primaryActionIntent === "close" ? onClose : onConvert;

  return {
    activeMessage: derivedState.activeMessage,
    expandedOverridePath,
    handleOverrideTargetSelect,
    handlePrimaryAction,
    hasImageItems: derivedState.hasImageItems,
    hasQuickPrefill: derivedState.hasQuickPrefill,
    hasVideoItems: derivedState.hasVideoItems,
    imageCount: derivedState.imageCount,
    imageQualityControl,
    imageQualityLabel: derivedState.imageQualityLabel,
    imageQualityValue,
    overrideItemRefs,
    primaryActionDisabled: derivedState.primaryActionDisabled,
    primaryActionLabel: derivedState.primaryActionLabel,
    progressTone: derivedState.progressTone,
    qualityNormalized: derivedState.qualityNormalized,
    runInProgress: derivedState.runInProgress,
    runPhase: derivedState.runPhase,
    sampleItem: derivedState.sampleItem,
    secondaryActionLabel: derivedState.secondaryActionLabel,
    selectedVideoPreset: derivedState.selectedVideoPreset,
    setItemOverrideFormat,
    setOutputMode,
    setRuleFormat,
    setSuffix,
    setVideoEncoder,
    setVideoPreset,
    setVideoSpeed,
    sortedOverrideItems: derivedState.sortedOverrideItems,
    toggleVideoAudio,
    totalItems: derivedState.totalItems,
    validationMessage: derivedState.validationMessage,
    videoCount: derivedState.videoCount,
    videoEncoderGroups: derivedState.videoEncoderGroups,
    videoQualityControl,
    videoQualityHint: derivedState.videoQualityHint,
    videoQualityLabel: derivedState.videoQualityLabel,
    videoQualityRange: derivedState.videoQualityRange,
    videoQualityValue: derivedState.videoQualityValue,
  };
};

export type ConversionModalModel = ReturnType<typeof useConversionModalModel>;
