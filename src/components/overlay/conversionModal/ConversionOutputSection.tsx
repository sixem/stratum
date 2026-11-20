// Output mode and suffix controls for the conversion modal.
import { PressButton } from "@/components/primitives";
import type { ConversionItemDraft, ConversionOutputMode } from "@/types";
import { conversionFileName } from "@/hooks/ui/app/conversion/conversionNames";

type ConversionOutputSectionProps = {
  outputMode: ConversionOutputMode;
  suffix: string;
  sampleItem: ConversionItemDraft | null;
  sampleFormat: string | null;
  runInProgress: boolean;
  onOutputModeChange: (outputMode: ConversionOutputMode) => void;
  onSuffixChange: (suffix: string) => void;
};

export const ConversionOutputSection = ({
  outputMode,
  suffix,
  sampleItem,
  sampleFormat,
  runInProgress,
  onOutputModeChange,
  onSuffixChange,
}: ConversionOutputSectionProps) => {
  return (
    <div className="conversion-block">
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
      {outputMode === "create-new" ? (
        <label className="conversion-suffix-field">
          <span>Suffix</span>
          <input
            type="text"
            className="prompt-input"
            value={suffix}
            spellCheck={false}
            onChange={(event) => onSuffixChange(event.target.value)}
            placeholder="_converted"
            disabled={runInProgress}
          />
        </label>
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
