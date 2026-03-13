// Conversion planning modal: thin container that wires feature-local model
// state into smaller presentational sections.
import { useEffect, useId, useRef } from "react";
import { PressButton } from "@/components/primitives";
import { useModalFocusTrap } from "@/hooks";
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
  onConvert: () => void;
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

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKey, { capture: true });
  }, [onClose, open]);

  if (!open || !request || !draft) return null;

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
              {model.videoCount > 0
                ? `${model.videoCount} video${model.videoCount === 1 ? "" : "s"}`
                : "No videos"}{" "}
              |{" "}
              {model.imageCount > 0
                ? `${model.imageCount} image${model.imageCount === 1 ? "" : "s"}`
                : "No images"}
            </p>
          </div>
          <PressButton type="button" className="btn ghost" onClick={onClose}>
            Close
          </PressButton>
        </div>
        <div className="conversion-body">
          <section className="conversion-right" aria-label="Conversion options">
            <div className="conversion-scroll-body">
              <ConversionOutputSection
                outputMode={draft.outputMode}
                suffix={draft.suffix}
                sampleItem={model.sampleItem}
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
