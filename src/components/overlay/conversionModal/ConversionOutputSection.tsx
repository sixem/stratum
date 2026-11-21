// Output mode and suffix controls for the conversion modal.
import { PressButton } from "@/components/primitives";
import { WarningIcon } from "@/components/icons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import type { ConversionItemDraft, ConversionOutputMode } from "@/types";
import { conversionFileName } from "@/hooks/ui/app/conversion/conversionNames";

type ConversionOutputSectionProps = {
  outputMode: ConversionOutputMode;
  suffix: string;
  sampleItem: ConversionItemDraft | null;
  sampleFormat: string | null;
  ffmpegStatus: { available: boolean; detail: string } | null;
  runInProgress: boolean;
  onOutputModeChange: (outputMode: ConversionOutputMode) => void;
  onSuffixChange: (suffix: string) => void;
};

export const ConversionOutputSection = ({
  outputMode,
  suffix,
  sampleItem,
  sampleFormat,
  ffmpegStatus,
  runInProgress,
  onOutputModeChange,
  onSuffixChange,
}: ConversionOutputSectionProps) => {
  const ffmpegLabel = ffmpegStatus?.available ? "FFmpeg fallback" : "FFmpeg unavailable";
  const ffmpegSummary = ffmpegStatus?.available
    ? "Video conversion is available using the automatic FFmpeg installation."
    : "Video conversion requires FFmpeg.";
  const ffmpegDetail = ffmpegStatus ? `${ffmpegSummary}\n\n${ffmpegStatus.detail}` : "";

  return (
    <div className="conversion-block">
      <div className="conversion-output-row">
        <div className="conversion-mode-toggle" role="radiogroup" aria-label="Output mode">
          <PressButton
            type="button"
            className={`conversion-mode-btn${outputMode === "replace" ? " is-active" : ""}`}
            role="radio"
            aria-checked={outputMode === "replace"}
            onClick={() => onOutputModeChange("replace")}
            disabled={runInProgress}
          >
            Replace original
          </PressButton>
          <PressButton
            type="button"
            className={`conversion-mode-btn${outputMode === "create-new" ? " is-active" : ""}`}
            role="radio"
            aria-checked={outputMode === "create-new"}
            onClick={() => onOutputModeChange("create-new")}
            disabled={runInProgress}
          >
            Create new
          </PressButton>
        </div>
        {ffmpegStatus ? (
          <TooltipWrapper text={ffmpegDetail}>
            <span
              className="conversion-ffmpeg-status"
              data-state={ffmpegStatus.available ? "fallback" : "unavailable"}
              role="note"
              tabIndex={0}
              aria-label={`${ffmpegLabel}. ${ffmpegDetail}`}
            >
              <WarningIcon />
              {ffmpegLabel}
            </span>
          </TooltipWrapper>
        ) : null}
      </div>
      {outputMode === "create-new" ? (
        <div className="conversion-suffix-field">
          <span>Suffix</span>
          <input
            type="text"
            className="prompt-input"
            aria-label="Suffix"
            value={suffix}
            spellCheck={false}
            onChange={(event) => onSuffixChange(event.target.value)}
            placeholder="_converted"
            disabled={runInProgress}
          />
        </div>
      ) : null}
      {sampleItem && sampleFormat ? (
        <div className="conversion-suffix-preview">
          {conversionFileName(sampleItem.name, sampleFormat, outputMode, suffix)}
          {" · "}{outputMode === "create-new" ? "Saves beside the original" : "Replaces the original after success"}
        </div>
      ) : null}
    </div>
  );
};
