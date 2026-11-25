// React-facing coordinator for the conversion modal. The hook keeps modal-only
// refs and effects local, while draft mutations and view shaping live in pure
// helpers beside it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversionItemDraft,
  ConversionMediaKind,
  ConversionModalDraft,
  ConversionModalRequest,
  ConversionOutputMode,
  ConversionRunState,
} from "@/types";
import { buildValidationMessage, sortConversionOverrideItems } from "./conversionModalConfig";
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

const EMPTY_OVERRIDE_ITEMS: ConversionItemDraft[] = [];

type UseConversionModalModelParams = {
  open: boolean;
  request: ConversionModalRequest | null;
  draft: ConversionModalDraft | null;
  runState: ConversionRunState | null;
  onDraftChange: (draft: ConversionModalDraft) => void;
  onConvert: (draft: ConversionModalDraft) => void;
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
  const draftItems = draft?.items ?? EMPTY_OVERRIDE_ITEMS;
  const { sortedOverrideItems, imageCount, videoCount } = useMemo(() => {
    const videoCount = draftItems.filter((item) => item.kind === "video").length;
    return {
      sortedOverrideItems: sortConversionOverrideItems(draftItems),
      imageCount: draftItems.length - videoCount,
      videoCount,
    };
  }, [draftItems]);
  const validationMessage = useMemo(
    () => request && draft ? buildValidationMessage(request, draft) : null,
    [draft, request],
  );
  const derivedState = useMemo(
    () =>
      buildConversionModalDerivedState({
        request,
        draft,
        runState,
        imageQualityValue,
        videoQualityInputValue: videoQualityControl.value,
        validationMessage,
      }),
    [draft, imageQualityValue, request, runState, validationMessage, videoQualityControl.value],
  );

  useEffect(() => {
    if (!open) return;
    setExpandedOverridePath((current) => current && sortedOverrideItems.some((item) => item.path === current) ? current : null);
  }, [open, sortedOverrideItems]);

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

  const handlePrimaryAction = () => {
    if (derivedState.primaryActionIntent === "close") return onClose();
    if (derivedState.primaryActionDisabled) return;
    imageQualityControl.flushPendingValue();
    videoQualityControl.flushPendingValue();
    if (draftRef.current) onConvert(draftRef.current);
  };

  return {
    activeMessage: derivedState.activeMessage,
    expandedOverridePath,
    handleOverrideTargetSelect,
    handlePrimaryAction,
    hasImageItems: derivedState.hasImageItems,
    hasQuickPrefill: derivedState.hasQuickPrefill,
    hasVideoItems: derivedState.hasVideoItems,
    imageCount,
    imageQualityControl,
    imageQualityLabel: derivedState.imageQualityLabel,
    imageQualityValue,
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
    sortedOverrideItems,
    toggleVideoAudio,
    totalItems: derivedState.totalItems,
    validationMessage: derivedState.validationMessage,
    videoCount,
    videoEncoderGroups: derivedState.videoEncoderGroups,
    videoQualityControl,
    videoQualityHint: derivedState.videoQualityHint,
    videoQualityLabel: derivedState.videoQualityLabel,
    videoQualityRange: derivedState.videoQualityRange,
    videoQualityValue: derivedState.videoQualityValue,
  };
};

export type ConversionModalModel = ReturnType<typeof useConversionModalModel>;
