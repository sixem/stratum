// Video-only encoder, preset, and quality controls for the conversion modal.
import type { DropdownGroup } from "@/components/primitives";
import { DropdownSelect, PressButton } from "@/components/primitives";
import { videoPresetGroups, videoSpeedGroups } from "./conversionModalConfig";

type ConversionVideoOptionsSectionProps = {
  presetId: string;
  encoder: string;
  speed: string;
  audioEnabled: boolean;
  videoEncoderGroups: DropdownGroup[];
  videoQualityLabel: string;
  videoQualityValue: number;
  videoQualityHint: string | null;
  videoQualityRange: {
    min: number;
    max: number;
    step: number;
  };
  selectedVideoPresetDescription: string | null;
  runInProgress: boolean;
  onPresetChange: (value: string | null) => void;
  onEncoderChange: (value: string | null) => void;
  onSpeedChange: (value: string | null) => void;
  onToggleAudio: () => void;
  onChangeQuality: (value: number) => void;
  onCommitQuality: () => void;
};

export const ConversionVideoOptionsSection = ({
  presetId,
  encoder,
  speed,
  audioEnabled,
  videoEncoderGroups,
  videoQualityLabel,
  videoQualityValue,
  videoQualityHint,
  videoQualityRange,
  selectedVideoPresetDescription,
  runInProgress,
  onPresetChange,
  onEncoderChange,
  onSpeedChange,
  onToggleAudio,
  onChangeQuality,
  onCommitQuality,
}: ConversionVideoOptionsSectionProps) => {
  return (
    <div className="conversion-block">
      <div className="conversion-video-panel">
        <div className="conversion-video-settings">
          <label className="conversion-field">
            <span>Preset</span>
            <DropdownSelect
              value={presetId}
              groups={videoPresetGroups}
              ariaLabel="Video preset"
              onChange={onPresetChange}
              disabled={runInProgress}
            />
          </label>
          <label className="conversion-field">
            <span>Encoder</span>
            <DropdownSelect
              value={encoder}
              groups={videoEncoderGroups}
              ariaLabel="Video encoder"
              onChange={onEncoderChange}
              disabled={runInProgress}
            />
          </label>
          <label className="conversion-field">
            <span>Speed</span>
            <DropdownSelect
              value={speed}
              groups={videoSpeedGroups}
              ariaLabel="Video speed"
              onChange={onSpeedChange}
              disabled={runInProgress}
            />
          </label>
        </div>
        <div className="conversion-video-meta">
          <label className="conversion-quality-field conversion-video-quality-field">
            <div className="conversion-quality-row">
              <span>{videoQualityLabel}</span>
              <output className="tnum">{videoQualityValue}</output>
            </div>
            <input
              type="range"
              className="conversion-quality-slider"
              min={videoQualityRange.min}
              max={videoQualityRange.max}
              step={videoQualityRange.step}
              value={videoQualityValue}
              onChange={(event) => onChangeQuality(Number(event.currentTarget.value))}
              onBlur={onCommitQuality}
              disabled={runInProgress}
            />
          </label>
          <div className="conversion-video-meta-footer">
            <div className="conversion-video-note-stack">
              <span className="conversion-rule-note">{videoQualityHint}</span>
              {selectedVideoPresetDescription ? (
                <div className="conversion-rule-note">{selectedVideoPresetDescription}</div>
              ) : (
                <div className="conversion-rule-note">
                  Custom profile tuned for current format and encoder.
                </div>
              )}
            </div>
            <PressButton
              type="button"
              className={`btn ghost conversion-toggle-btn${audioEnabled ? " is-enabled" : " is-disabled"}`}
              onClick={onToggleAudio}
              disabled={runInProgress}
            >
              {audioEnabled ? "Audio on" : "Audio off"}
            </PressButton>
          </div>
        </div>
      </div>
    </div>
  );
};
