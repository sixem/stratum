// Conversion planning modal: thin container that wires feature-local model
// state into smaller presentational sections.
import { useId, useRef } from "react";
import { DialogCloseButton } from "@/components/overlay/DialogCloseButton";
import { useModalFocusTrap } from "@/hooks";
import { isPlainEscape, releaseInputFocusOnEscape } from "@/hooks/ui/inputs/inputFocus";
import { useShellStore } from "@/modules";
import { findRuleFormat } from "./conversionModalConfig";
import type {
  ConversionModalDraft,
  ConversionModalRequest,
  ConversionRunState,
} from "@/types";
import { ConversionImageOptionsSection } from "./ConversionImageOptionsSection";
import { ConversionOutputSection } from "./ConversionOutputSection";
import { ConversionOverrideList } from "./ConversionOverrideList";
import { ConversionProgressStrip } from "./ConversionProgressStrip";
import { ConversionRuleSection } from "./ConversionRuleSection";
import { ConversionVideoOptionsSection } from "./ConversionVideoOptionsSection";
import { useConversionModalModel } from "./useConversionModalModel";

export type ConversionModalProps = {
  open: boolean;
  request: ConversionModalRequest | null;
  draft: ConversionModalDraft | null;
  runState: ConversionRunState | null;
  onDraftChange: (draft: ConversionModalDraft) => void;
  onConvert: (draft: ConversionModalDraft) => void;
  onClose: () => void;
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
  const availability = useShellStore(state => state.availability);
  const model = useConversionModalModel({
    open,
    request,
    draft,
    runState,
    onDraftChange,
    onConvert,
    onClose,
  });

  useModalFocusTrap({
    open,
    containerRef: panelRef,
    initialFocusRef: cancelButtonRef,
  });

  if (!open || !request || !draft) return null;

  // An invalid configured path can still resolve to a working automatic installation.
  const ffmpegStatus = model.hasVideoItems && availability && (!availability.ffmpeg || availability.ffmpegMessage)
    ? {
        available: availability.ffmpeg,
        detail: availability.ffmpegMessage ?? "Choose ffmpeg.exe in Settings.",
      }
    : null;

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
        onKeyDown={(event) => {
          if (!isPlainEscape(event.nativeEvent) || releaseInputFocusOnEscape(event.nativeEvent)) return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <div className="conversion-header">
          <div className="conversion-heading">
            <h2 id={titleId}>{model.hasVideoItems && !model.hasImageItems ? "Convert video" : "Convert files"}</h2>
            <p className="conversion-selection-note tnum">
              {[
                model.videoCount > 0 && `${model.videoCount} video${model.videoCount === 1 ? "" : "s"}`,
                model.imageCount > 0 && `${model.imageCount} image${model.imageCount === 1 ? "" : "s"}`,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
          <DialogCloseButton onClose={onClose} />
        </div>
        <div className="conversion-body">
          <section className="conversion-right" aria-label="Conversion options">
            <div className="conversion-scroll-body">
              <ConversionOutputSection
                outputMode={draft.outputMode}
                suffix={draft.suffix}
                sampleItem={model.sampleItem}
                ffmpegStatus={ffmpegStatus}
                sampleFormat={model.sampleItem && (model.sampleItem.override?.targetFormat ?? findRuleFormat(draft, model.sampleItem.kind))}
                runInProgress={model.runInProgress}
                onOutputModeChange={model.setOutputMode}
                onSuffixChange={model.setSuffix}
              />
              <ConversionRuleSection
                request={request}
                draft={draft}
                hasQuickPrefill={model.hasQuickPrefill}
                runInProgress={model.runInProgress}
                onRuleFormatChange={model.setRuleFormat}
              />
              {model.hasImageItems ? (
                <ConversionImageOptionsSection
                  imageQualityValue={model.imageQualityValue}
                  qualityNormalized={model.qualityNormalized}
                  imageQualityLabel={model.imageQualityLabel}
                  runInProgress={model.runInProgress}
                  onChangeQuality={model.imageQualityControl.setValue}
                  onCommitQuality={model.imageQualityControl.flushPendingValue}
                />
              ) : null}
              {model.hasVideoItems ? (
                <ConversionVideoOptionsSection
                  presetId={draft.videoOptions.presetId}
                  encoder={draft.videoOptions.encoder}
                  speed={draft.videoOptions.speed}
                  audioEnabled={draft.videoOptions.audioEnabled}
                  videoEncoderGroups={model.videoEncoderGroups}
                  videoQualityLabel={model.videoQualityLabel}
                  videoQualityValue={model.videoQualityValue}
                  videoQualityHint={model.videoQualityHint}
                  videoQualityRange={model.videoQualityRange}
                  selectedVideoPresetDescription={
                    model.selectedVideoPreset?.description ?? null
                  }
                  runInProgress={model.runInProgress}
                  onPresetChange={model.setVideoPreset}
                  onEncoderChange={model.setVideoEncoder}
                  onSpeedChange={model.setVideoSpeed}
                  onToggleAudio={model.toggleVideoAudio}
                  onChangeQuality={model.videoQualityControl.setValue}
                  onCommitQuality={model.videoQualityControl.flushPendingValue}
                />
              ) : null}
              <ConversionOverrideList
                draft={draft}
                runState={runState}
                sortedOverrideItems={model.sortedOverrideItems}
                titleId={titleId}
                expandedOverridePath={model.expandedOverridePath}
                overrideItemRefs={model.overrideItemRefs}
                runInProgress={model.runInProgress}
                onOverrideToggle={model.handleOverrideTargetSelect}
                onOverrideFormatChange={model.setItemOverrideFormat}
              />
            </div>
            <ConversionProgressStrip
              tone={model.progressTone}
              activeMessage={model.activeMessage}
              cancelButtonRef={cancelButtonRef}
              secondaryActionLabel={model.secondaryActionLabel}
              primaryActionLabel={model.primaryActionLabel}
              primaryActionDisabled={model.primaryActionDisabled}
              onClose={onClose}
              onPrimaryAction={model.handlePrimaryAction}
            />
          </section>
        </div>
      </div>
    </div>
  );
};
