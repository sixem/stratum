// UI-facing conversion draft models used by the conversion modal.
export type ConversionMediaKind = "image" | "video";

export type ConversionOutputMode = "replace" | "create-new";

export type ConversionVideoEncoder = "libx264" | "libvpx-vp9";

export type ConversionVideoSpeed = "fast" | "balanced" | "quality";

export type ConversionVideoFormat = "mp4" | "webm" | "mkv" | "mov" | "avi";

export type ConversionVideoPresetId =
  | "custom"
  | "mp4_fast"
  | "mp4_balanced"
  | "mp4_quality"
  | "mp4_small"
  | "webm_fast"
  | "webm_balanced"
  | "webm_quality"
  | "webm_small"
  | "mkv_fast"
  | "mkv_balanced"
  | "mkv_quality"
  | "mkv_small"
  | "mov_fast"
  | "mov_balanced"
  | "mov_quality"
  | "mov_small";

export type ConversionRuleDraft = {
  kind: ConversionMediaKind;
  targetFormat: string | null;
  presetId?: string | null;
};

export type ConversionRuleOverrideDraft = {
  targetFormat: string | null;
  presetId?: string | null;
};

export type ConversionItemDraft = {
  path: string;
  name: string;
  kind: ConversionMediaKind;
  sourceExt: string | null;
  override?: ConversionRuleOverrideDraft | null;
};

export type ConversionModalRequest = {
  paths: string[];
  items: ConversionItemDraft[];
  sourceKinds: ConversionMediaKind[];
  quickTargetFormat: string | null;
  quickTargetKind: ConversionMediaKind | null;
};

export type ConversionModalDraft = {
  outputMode: ConversionOutputMode;
  suffix: string;
  imageOptions: {
    quality: number;
  };
  videoOptions: {
    presetId: ConversionVideoPresetId;
    encoder: ConversionVideoEncoder;
    speed: ConversionVideoSpeed;
    quality: number;
    audioEnabled: boolean;
  };
  rules: ConversionRuleDraft[];
  items: ConversionItemDraft[];
};

export type ConversionItemRunStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "warning";

export type ConversionRunPhase = "idle" | "running" | "completed" | "failed";

export type ConversionRunState = {
  phase: ConversionRunPhase;
  message: string | null;
  total: number;
  processed: number;
  completed: number;
  failed: number;
  itemStatusByPath: Record<string, ConversionItemRunStatus>;
  itemMessageByPath: Record<string, string | null>;
  transferJobId: string | null;
};
