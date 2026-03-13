// Image-only quality controls for the conversion modal.
type ConversionImageOptionsSectionProps = {
  imageQualityValue: number;
  qualityNormalized: string;
  imageQualityLabel: string;
  runInProgress: boolean;
  onChangeQuality: (value: number) => void;
  onCommitQuality: () => void;
};

export const ConversionImageOptionsSection = ({
  imageQualityValue,
  qualityNormalized,
  imageQualityLabel,
  runInProgress,
  onChangeQuality,
  onCommitQuality,
}: ConversionImageOptionsSectionProps) => {
  return (
    <div className="conversion-block">
      <label className="conversion-quality-field">
        <div className="conversion-quality-row">
          <span>Image quality</span>
          <output className="tnum">{qualityNormalized}</output>
        </div>
        <input
          type="range"
          className="conversion-quality-slider"
          min={1}
          max={100}
          step={1}
          value={imageQualityValue}
          onChange={(event) => onChangeQuality(Number(event.currentTarget.value))}
          onBlur={onCommitQuality}
          disabled={runInProgress}
        />
      </label>
      <div className="conversion-rule-note">
        {imageQualityLabel}. Applies to JPG/JPEG/JFIF quality and PNG compression.
      </div>
    </div>
  );
};
