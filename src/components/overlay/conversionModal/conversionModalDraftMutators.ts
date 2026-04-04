// Pure draft mutation helpers for the conversion modal. These functions keep
// business rules out of the React hook so they can be tested in isolation.
import {
  clampVideoQuality,
  getVideoConvertPreset,
  resolveVideoEncoderForFormat,
} from "@/constants";
import type {
  ConversionMediaKind,
  ConversionModalDraft,
  ConversionOutputMode,
  ConversionVideoEncoder,
  ConversionVideoSpeed,
} from "@/types";
import { asVideoFormat, findRuleFormat } from "./conversionModalConfig";

type ConversionDraftRules = ConversionModalDraft["rules"];
type ConversionVideoOptions = ConversionModalDraft["videoOptions"];

const clampImageQuality = (quality: number) => {
  return Math.min(100, Math.max(1, Math.round(quality)));
};

const markVideoRuleCustom = (rules: ConversionDraftRules): ConversionDraftRules => {
  return rules.map((rule) =>
    rule.kind === "video" ? { ...rule, presetId: "custom" } : rule,
  );
};

const syncVideoRule = (
  rules: ConversionDraftRules,
  patch: Partial<ConversionDraftRules[number]>,
): ConversionDraftRules => {
  return rules.map((rule) =>
    rule.kind === "video"
      ? {
          ...rule,
          ...patch,
        }
      : rule,
  );
};

const updateVideoOptions = (
  draft: ConversionModalDraft,
  updater: (videoOptions: ConversionVideoOptions) => ConversionVideoOptions,
  options?: {
    rules?: (
      rules: ConversionDraftRules,
      nextVideoOptions: ConversionVideoOptions,
    ) => ConversionDraftRules;
  },
): ConversionModalDraft => {
  const nextVideoOptions = updater(draft.videoOptions);
  const nextRules = options?.rules
    ? options.rules(draft.rules, nextVideoOptions)
    : draft.rules;

  return {
    ...draft,
    videoOptions: nextVideoOptions,
    rules: nextRules,
  };
};

export const setConversionOutputMode = (
  draft: ConversionModalDraft,
  outputMode: ConversionOutputMode,
): ConversionModalDraft => {
  if (draft.outputMode === outputMode) {
    return draft;
  }
  return {
    ...draft,
    outputMode,
  };
};

export const setConversionSuffix = (
  draft: ConversionModalDraft,
  suffix: string,
): ConversionModalDraft => {
  if (draft.suffix === suffix) {
    return draft;
  }
  return {
    ...draft,
    suffix,
  };
};

export const setConversionImageQuality = (
  draft: ConversionModalDraft,
  quality: number,
): ConversionModalDraft => {
  const nextQuality = clampImageQuality(quality);
  if (draft.imageOptions.quality === nextQuality) {
    return draft;
  }
  return {
    ...draft,
    imageOptions: {
      ...draft.imageOptions,
      quality: nextQuality,
    },
  };
};

export const setConversionVideoQuality = (
  draft: ConversionModalDraft,
  quality: number,
): ConversionModalDraft => {
  return updateVideoOptions(
    draft,
    (videoOptions) => {
      const nextQuality = clampVideoQuality(videoOptions.encoder, quality);
      if (
        videoOptions.presetId === "custom" &&
        videoOptions.quality === nextQuality
      ) {
        return videoOptions;
      }
      return {
        ...videoOptions,
        presetId: "custom",
        quality: nextQuality,
      };
    },
    {
      rules: (rules) => markVideoRuleCustom(rules),
    },
  );
};

export const setConversionRuleFormat = (
  draft: ConversionModalDraft,
  kind: ConversionMediaKind,
  targetFormat: string | null,
): ConversionModalDraft => {
  if (kind !== "video") {
    return {
      ...draft,
      rules: draft.rules.map((rule) =>
        rule.kind === kind
          ? {
              ...rule,
              targetFormat,
              presetId: rule.presetId ?? null,
            }
          : rule,
      ),
    };
  }

  return updateVideoOptions(
    draft,
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
};

export const setConversionItemOverrideFormat = (
  draft: ConversionModalDraft,
  itemPath: string,
  targetFormat: string | null,
): ConversionModalDraft => {
  return {
    ...draft,
    items: draft.items.map((item) =>
      item.path === itemPath
        ? {
            ...item,
            override: targetFormat ? { targetFormat, presetId: null } : null,
          }
        : item,
    ),
  };
};

export const setConversionVideoPreset = (
  draft: ConversionModalDraft,
  presetValue: string | null,
): ConversionModalDraft => {
  if (!presetValue) {
    return draft;
  }

  if (presetValue === "custom") {
    if (draft.videoOptions.presetId === "custom") {
      return draft;
    }
    return updateVideoOptions(
      draft,
      (videoOptions) => ({
        ...videoOptions,
        presetId: "custom",
      }),
      {
        rules: (rules) => markVideoRuleCustom(rules),
      },
    );
  }

  const preset = getVideoConvertPreset(presetValue);
  if (!preset) {
    return draft;
  }

  return updateVideoOptions(
    draft,
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
};

export const setConversionVideoEncoder = (
  draft: ConversionModalDraft,
  encoderValue: string | null,
): ConversionModalDraft => {
  if (!encoderValue) {
    return draft;
  }

  const requestedEncoder = encoderValue as ConversionVideoEncoder;
  const selectedVideoFormat = asVideoFormat(findRuleFormat(draft, "video"));

  return updateVideoOptions(
    draft,
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
};

export const setConversionVideoSpeed = (
  draft: ConversionModalDraft,
  speedValue: string | null,
): ConversionModalDraft => {
  if (!speedValue) {
    return draft;
  }

  return updateVideoOptions(
    draft,
    (videoOptions) => ({
      ...videoOptions,
      presetId: "custom",
      speed: speedValue as ConversionVideoSpeed,
    }),
    {
      rules: (rules) => markVideoRuleCustom(rules),
    },
  );
};

export const toggleConversionVideoAudio = (
  draft: ConversionModalDraft,
): ConversionModalDraft => {
  return updateVideoOptions(
    draft,
    (videoOptions) => ({
      ...videoOptions,
      presetId: "custom",
      audioEnabled: !videoOptions.audioEnabled,
    }),
    {
      rules: (rules) => markVideoRuleCustom(rules),
    },
  );
};
