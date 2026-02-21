// Conversion planning modal: captures conversion intent without executing backend work.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  DropdownSelect,
  type DropdownGroup,
  PressButton,
} from "@/components/primitives";
import { useModalFocusTrap } from "@/hooks";
import {
  CONVERT_FORMAT_LABELS,
  CONVERT_TARGET_GROUPS,
  QUICK_CONVERT_PRESET_LABELS,
  VIDEO_CONVERT_PRESETS,
  VIDEO_ENCODER_LABELS,
  VIDEO_QUALITY_RANGES,
  VIDEO_SPEED_LABELS,
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
  ConversionVideoEncoder,
  ConversionVideoFormat,
  ConversionVideoSpeed,
  ConversionRunState,
} from "@/types";

export type ConversionModalProps = {
  open: boolean;
  request: ConversionModalRequest | null;
  draft: ConversionModalDraft | null;
  runState: ConversionRunState | null;
  onDraftChange: (draft: ConversionModalDraft) => void;
  onConvert: () => void;
  onClose: () => void;
};

const KIND_LABELS: Record<ConversionMediaKind, string> = {
  image: "Images",
  video: "Videos",
};

const FORMAT_DETAIL_LABELS: Record<string, string> = {
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

const RUN_PHASE_LABELS = {
  idle: "Ready",
  running: "Converting",
  completed: "Completed",
  failed: "Completed with issues",
} as const;

const ITEM_STATUS_LABELS = {
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

const ruleGroupsByKind: Record<ConversionMediaKind, DropdownGroup[]> = {
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

const overrideGroupsByKind: Record<ConversionMediaKind, DropdownGroup[]> = {
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

const videoPresetGroups: DropdownGroup[] = [
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

const videoSpeedGroups: DropdownGroup[] = [
  {
    id: "video-speed",
    options: (Object.keys(VIDEO_SPEED_LABELS) as ConversionVideoSpeed[]).map((speed) => ({
      value: speed,
      label: VIDEO_SPEED_LABELS[speed],
    })),
  },
];

const findRuleFormat = (draft: ConversionModalDraft, kind: ConversionMediaKind) => {
  return draft.rules.find((rule) => rule.kind === kind)?.targetFormat ?? null;
};

const asVideoFormat = (value: string | null): ConversionVideoFormat | null => {
  if (value === "mp4" || value === "webm" || value === "mkv" || value === "mov" || value === "avi") {
    return value;
  }
  return null;
};

const buildValidationMessage = (request: ConversionModalRequest, draft: ConversionModalDraft) => {
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

const buildExampleName = (item: ConversionItemDraft, mode: ConversionOutputMode, suffix: string) => {
  const sourceExt = item.sourceExt ? `.${item.sourceExt}` : "";
  const baseName = sourceExt && item.name.endsWith(sourceExt)
    ? item.name.slice(0, -sourceExt.length)
    : item.name;
  if (mode === "replace") return item.name;
  return `${baseName}${suffix}${sourceExt}`;
};

const formatQualityNormalized = (quality: number) => {
  const normalized = Math.min(100, Math.max(1, quality)) / 100;
  return normalized.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const describeImageQuality = (quality: number) => {
  if (quality <= 35) return "Size-priority (stronger compression)";
  if (quality <= 70) return "Balanced output";
  if (quality <= 90) return "Detail-priority";
  return "Maximum detail / lowest PNG compression";
};

const formatVideoQualityLabel = (encoder: ConversionVideoEncoder) => {
  return VIDEO_QUALITY_RANGES[encoder].label;
};

const describeVideoQuality = (encoder: ConversionVideoEncoder, value: number) => {
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

export const ConversionModal = ({
  open,
  request,
  draft,
  runState,
  onDraftChange,
  onConvert,
  onClose,
}: ConversionModalProps) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const shouldCloseRef = useRef(false);
  const [activeOverridePath, setActiveOverridePath] = useState<string | null>(null);
  const [overrideEditorOpen, setOverrideEditorOpen] = useState(true);

  useModalFocusTrap({
    open,
    containerRef: panelRef,
    initialFocusRef: cancelButtonRef,
  });

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, [onClose, open]);

  const requestKey = request?.paths.join("|") ?? "";
  const sortedOverrideItems = useMemo(() => {
    if (!draft) return [] as ConversionItemDraft[];
    return [...draft.items].sort((left, right) => {
      const kindDelta = MEDIA_KIND_PRIORITY[left.kind] - MEDIA_KIND_PRIORITY[right.kind];
      if (kindDelta !== 0) return kindDelta;
      return left.name.localeCompare(right.name);
    });
  }, [draft]);
  const itemPathsKey = sortedOverrideItems.map((item) => item.path).join("|");
  useEffect(() => {
    if (!open || !draft) return;
    setActiveOverridePath((current) => {
      if (current && sortedOverrideItems.some((item) => item.path === current)) {
        return current;
      }
      return null;
    });
  }, [draft, itemPathsKey, open, requestKey, sortedOverrideItems]);
  useEffect(() => {
    if (!open) return;
    setOverrideEditorOpen(true);
  }, [open, requestKey]);

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
  const videoEncoderGroups = useMemo<DropdownGroup[]>(
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
  const videoQualityLabel = draft ? formatVideoQualityLabel(draft.videoOptions.encoder) : "CRF";
  const videoQualityHint = draft
    ? describeVideoQuality(draft.videoOptions.encoder, draft.videoOptions.quality)
    : null;

  const updateDraft = (next: ConversionModalDraft) => {
    onDraftChange(next);
  };

  const setOutputMode = (outputMode: ConversionOutputMode) => {
    if (!draft || draft.outputMode === outputMode) return;
    updateDraft({ ...draft, outputMode });
  };

  const setSuffix = (suffix: string) => {
    if (!draft) return;
    updateDraft({ ...draft, suffix });
  };

  const setRuleFormat = (kind: ConversionMediaKind, targetFormat: string | null) => {
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
              presetId: kind === "video" ? nextVideoOptions.presetId : rule.presetId ?? null,
            }
          : rule,
      ),
    });
  };

  const setItemOverrideFormat = (itemPath: string, targetFormat: string | null) => {
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
  };

  const handleOverrideTargetSelect = (itemPath: string) => {
    if (activeOverridePath === itemPath) {
      setOverrideEditorOpen((current) => !current);
      return;
    }
    setActiveOverridePath(itemPath);
    setOverrideEditorOpen(true);
  };

  const setImageQuality = (quality: number) => {
    if (!draft) return;
    const clamped = Math.min(100, Math.max(1, Math.round(quality)));
    updateDraft({
      ...draft,
      imageOptions: {
        ...draft.imageOptions,
        quality: clamped,
      },
    });
  };

  const setVideoPreset = (presetValue: string | null) => {
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
  };

  const setVideoEncoder = (encoderValue: string | null) => {
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
  };

  const setVideoSpeed = (speedValue: string | null) => {
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
  };

  const setVideoQuality = (value: number) => {
    if (!draft) return;
    const clamped = clampVideoQuality(draft.videoOptions.encoder, value);
    updateDraft({
      ...draft,
      videoOptions: {
        ...draft.videoOptions,
        presetId: "custom",
        quality: clamped,
      },
      rules: draft.rules.map((rule) =>
        rule.kind === "video" ? { ...rule, presetId: "custom" } : rule,
      ),
    });
  };

  const toggleVideoAudio = () => {
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
  };

  if (!open || !request || !draft) return null;
  const runPhase = runState?.phase ?? "idle";
  const runInProgress = runPhase === "running";
  const hasImageItems = request.sourceKinds.includes("image");
  const hasVideoItems = request.sourceKinds.includes("video");
  const totalItems = runState?.total ?? request.items.length;
  const processed = runState?.processed ?? 0;
  const completed = runState?.completed ?? 0;
  const failed = runState?.failed ?? 0;
  const phaseLabel = RUN_PHASE_LABELS[runPhase];

  const hasQuickPrefill =
    Boolean(request.quickTargetKind) && Boolean(request.quickTargetFormat);
  const sampleItem = draft.items[0] ?? null;
  const videoCount = sortedOverrideItems.filter((item) => item.kind === "video").length;
  const imageCount = sortedOverrideItems.filter((item) => item.kind === "image").length;
  const activeOverrideItem =
    sortedOverrideItems.find((item) => item.path === activeOverridePath) ?? null;
  const activeOverrideDefaultFormat = activeOverrideItem
    ? findRuleFormat(draft, activeOverrideItem.kind)
    : null;
  const activeOverrideFormat = activeOverrideItem?.override?.targetFormat ?? activeOverrideDefaultFormat;
  const activeOverrideFormatLabel = activeOverrideFormat
    ? CONVERT_FORMAT_LABELS[activeOverrideFormat] ?? activeOverrideFormat.toUpperCase()
    : "No format selected";
  const activeOverrideFormatDetail = activeOverrideFormat
    ? FORMAT_DETAIL_LABELS[activeOverrideFormat] ??
      `${CONVERT_FORMAT_LABELS[activeOverrideFormat] ?? activeOverrideFormat.toUpperCase()} format`
    : "Using selected type default format.";
  const qualityNormalized = formatQualityNormalized(draft.imageOptions.quality);
  const imageQualityLabel = describeImageQuality(draft.imageOptions.quality);
  const validationMessage = buildValidationMessage(request, draft);
  const activeMessage = validationMessage
    ? validationMessage
    : runState?.message ??
      (runPhase === "idle"
        ? `Ready to convert ${totalItems} item${totalItems === 1 ? "" : "s"}.`
        : null);
  const progressTone = validationMessage && runPhase === "idle" ? "warning" : runPhase;
  const finishedRun = runPhase === "completed" || runPhase === "failed";
  const canConvert = !runInProgress && !validationMessage && !finishedRun;
  const primaryActionLabel = runInProgress ? "Converting..." : finishedRun ? "Dismiss" : "Convert";
  const handlePrimaryAction = finishedRun ? onClose : onConvert;
  const primaryActionDisabled = runInProgress || (!finishedRun && !canConvert);

  return (
    <div
      className="conversion-modal"
      data-open={open ? "true" : "false"}
      aria-hidden={open ? "false" : "true"}
      onMouseDown={(event) => {
        shouldCloseRef.current = event.target === event.currentTarget;
      }}
      onClick={() => {
        if (shouldCloseRef.current) {
          onClose();
        }
        shouldCloseRef.current = false;
      }}
    >
      <div
        className="conversion-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="conversion-header">
          <div className="conversion-heading">
            <h2 id={titleId}>Convert files</h2>
            <p className="conversion-selection-note">
              {videoCount > 0 ? `${videoCount} video${videoCount === 1 ? "" : "s"}` : "No videos"} |{" "}
              {imageCount > 0 ? `${imageCount} image${imageCount === 1 ? "" : "s"}` : "No images"}
            </p>
          </div>
          <PressButton type="button" className="btn ghost" onClick={onClose}>
            Close
          </PressButton>
        </div>
        <div className="conversion-body">
          <section className="conversion-right" aria-label="Conversion options">
            <div className="conversion-block">
              <div className="conversion-mode-toggle" role="radiogroup" aria-label="Output mode">
                <PressButton
                  type="button"
                  className={`conversion-mode-btn${draft.outputMode === "replace" ? " is-active" : ""}`}
                  role="radio"
                  aria-checked={draft.outputMode === "replace"}
                  onClick={() => setOutputMode("replace")}
                  disabled={runInProgress}
                >
                  Replace original
                </PressButton>
                <PressButton
                  type="button"
                  className={`conversion-mode-btn${draft.outputMode === "create-new" ? " is-active" : ""}`}
                  role="radio"
                  aria-checked={draft.outputMode === "create-new"}
                  onClick={() => setOutputMode("create-new")}
                  disabled={runInProgress}
                >
                  Create new
                </PressButton>
              </div>
              {draft.outputMode === "create-new" ? (
                <label className="conversion-suffix-field">
                  <span>Suffix</span>
                  <input
                    type="text"
                    className="prompt-input"
                    value={draft.suffix}
                    spellCheck={false}
                    onChange={(event) => setSuffix(event.target.value)}
                    placeholder="_converted"
                    disabled={runInProgress}
                  />
                </label>
              ) : null}
              {draft.outputMode === "create-new" && sampleItem ? (
                <div className="conversion-suffix-preview">
                  Example: {buildExampleName(sampleItem, draft.outputMode, draft.suffix)}
                </div>
              ) : null}
            </div>

            <div className="conversion-block">
              {request.sourceKinds.map((kind) => {
                const selectedFormat = findRuleFormat(draft, kind) ?? "";
                return (
                  <div key={kind} className="conversion-rule-card">
                    <div className="conversion-rule-header">
                      <span>{KIND_LABELS[kind]} default format</span>
                    </div>
                    <DropdownSelect
                      value={selectedFormat}
                      groups={ruleGroupsByKind[kind]}
                      placeholder="Choose target format"
                      ariaLabel={`${KIND_LABELS[kind]} target format`}
                      onChange={(next) => setRuleFormat(kind, next)}
                      disabled={runInProgress}
                    />
                    {hasQuickPrefill &&
                    request.quickTargetKind === kind &&
                    request.quickTargetFormat ? (
                      <div className="conversion-rule-note">
                        {QUICK_CONVERT_PRESET_LABELS[request.quickTargetFormat] ??
                          "Quick convert preset"}{" "}
                        prefilled this rule.
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {hasImageItems ? (
              <div className="conversion-block">
                <label className="conversion-quality-field">
                  <div className="conversion-quality-row">
                    <span>Image quality</span>
                    <output className="tnum">
                      {qualityNormalized}
                    </output>
                  </div>
                  <input
                    type="range"
                    className="conversion-quality-slider"
                    min={1}
                    max={100}
                    step={1}
                    value={draft.imageOptions.quality}
                    onChange={(event) => setImageQuality(Number(event.currentTarget.value))}
                    disabled={runInProgress}
                  />
                </label>
                <div className="conversion-rule-note">
                  {imageQualityLabel}. Applies to JPG/JPEG/JFIF quality and PNG compression.
                </div>
              </div>
            ) : null}

            {hasVideoItems ? (
              <div className="conversion-block">
                <label className="conversion-field">
                  <span>Preset</span>
                  <DropdownSelect
                    value={draft.videoOptions.presetId}
                    groups={videoPresetGroups}
                    ariaLabel="Video preset"
                    onChange={setVideoPreset}
                    disabled={runInProgress}
                  />
                </label>
                <div className="conversion-video-grid">
                  <label className="conversion-field">
                    <span>Encoder</span>
                    <DropdownSelect
                      value={draft.videoOptions.encoder}
                      groups={videoEncoderGroups}
                      ariaLabel="Video encoder"
                      onChange={setVideoEncoder}
                      disabled={runInProgress}
                    />
                  </label>
                  <label className="conversion-field">
                    <span>Speed</span>
                    <DropdownSelect
                      value={draft.videoOptions.speed}
                      groups={videoSpeedGroups}
                      ariaLabel="Video speed"
                      onChange={setVideoSpeed}
                      disabled={runInProgress}
                    />
                  </label>
                </div>
                <label className="conversion-quality-field">
                  <div className="conversion-quality-row">
                    <span>{videoQualityLabel}</span>
                    <output className="tnum">{draft.videoOptions.quality}</output>
                  </div>
                  <input
                    type="range"
                    className="conversion-quality-slider"
                    min={videoQualityRange.min}
                    max={videoQualityRange.max}
                    step={videoQualityRange.step}
                    value={draft.videoOptions.quality}
                    onChange={(event) => setVideoQuality(Number(event.currentTarget.value))}
                    disabled={runInProgress}
                  />
                </label>
                <div className="conversion-video-row">
                  <PressButton
                    type="button"
                    className={`btn ghost conversion-toggle-btn${draft.videoOptions.audioEnabled ? " is-enabled" : " is-disabled"}`}
                    onClick={toggleVideoAudio}
                    disabled={runInProgress}
                  >
                    {draft.videoOptions.audioEnabled ? "Audio on" : "Audio off"}
                  </PressButton>
                  <span className="conversion-rule-note">{videoQualityHint}</span>
                </div>
                {selectedVideoPreset ? (
                  <div className="conversion-rule-note">{selectedVideoPreset.description}</div>
                ) : (
                  <div className="conversion-rule-note">
                    Custom profile tuned for current format and encoder.
                  </div>
                )}
              </div>
            ) : null}

            <div className="conversion-block">
              <div className="conversion-override-list" role="listbox" aria-label="Override target item">
                {sortedOverrideItems.map((item) => {
                  const defaultFormat = findRuleFormat(draft, item.kind);
                  const appliedFormat = item.override?.targetFormat ?? defaultFormat;
                  const itemStatus = runState?.itemStatusByPath[item.path] ?? "idle";
                  const itemStatusLabel = ITEM_STATUS_LABELS[itemStatus];
                  const isActive = overrideEditorOpen && activeOverrideItem?.path === item.path;
                  const hasOverride = Boolean(item.override?.targetFormat);
                  return (
                    <PressButton
                      key={item.path}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`conversion-override-item${isActive ? " is-active" : ""}${hasOverride ? " is-overridden" : ""}`}
                      onClick={() => handleOverrideTargetSelect(item.path)}
                      disabled={runInProgress}
                    >
                      <span className="conversion-override-name">{item.name}</span>
                      <span className="conversion-override-right">
                        <span className={`conversion-item-status is-${itemStatus}`}>
                          {itemStatusLabel}
                        </span>
                        <span className="conversion-override-summary">
                          {appliedFormat
                            ? CONVERT_FORMAT_LABELS[appliedFormat] ?? appliedFormat.toUpperCase()
                            : "No format selected"}
                        </span>
                      </span>
                    </PressButton>
                  );
                })}
              </div>
              {activeOverrideItem && overrideEditorOpen ? (
                <div className="conversion-override-editor">
                  <div className="conversion-override-editor-head">
                    <span className="conversion-override-editor-item" title={activeOverrideItem.name}>
                      {activeOverrideItem.name}
                    </span>
                    <span className="conversion-override-summary">
                      {activeOverrideFormatLabel}
                    </span>
                  </div>
                  <label className="conversion-override-editor-field">
                    <span>Target format override</span>
                    <DropdownSelect
                      value={activeOverrideItem.override?.targetFormat ?? null}
                      groups={overrideGroupsByKind[activeOverrideItem.kind]}
                      placeholder="Choose target format"
                      ariaLabel={`Override format for ${activeOverrideItem.name}`}
                      onChange={(next) => setItemOverrideFormat(activeOverrideItem.path, next)}
                      disabled={runInProgress}
                    />
                  </label>
                  <div className="conversion-override-editor-foot">
                    <span className="conversion-override-format-note" title={activeOverrideFormatDetail}>
                      {activeOverrideFormatDetail}
                    </span>
                    <PressButton
                      type="button"
                      className="btn ghost conversion-clear-override"
                      onClick={() => setItemOverrideFormat(activeOverrideItem.path, null)}
                      disabled={!activeOverrideItem.override?.targetFormat || runInProgress}
                    >
                      Use type default
                    </PressButton>
                  </div>
                </div>
              ) : null}
            </div>

            <div className={`conversion-progress-strip is-${progressTone}`}>
              <div className="conversion-progress-head">
                <span className="conversion-progress-phase">{phaseLabel}</span>
                <span className="conversion-progress-count tnum">
                  {processed}/{totalItems}
                </span>
              </div>
              <div className="conversion-progress-metrics">
                <span>
                  <span className="tnum">{completed}</span> done
                </span>
                <span>
                  <span className="tnum">{failed}</span> failed
                </span>
              </div>
              <div className="conversion-progress-bottom">
                <div className="conversion-progress-detail" title={activeMessage ?? undefined}>
                  {activeMessage ?? ""}
                </div>
                <div className="conversion-progress-footer">
                  <PressButton
                    ref={cancelButtonRef}
                    type="button"
                    className="btn ghost"
                    onClick={onClose}
                  >
                    {runInProgress ? "Hide" : "Cancel"}
                  </PressButton>
                  <PressButton
                    type="button"
                    className="btn"
                    onClick={handlePrimaryAction}
                    disabled={primaryActionDisabled}
                  >
                    {primaryActionLabel}
                  </PressButton>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
