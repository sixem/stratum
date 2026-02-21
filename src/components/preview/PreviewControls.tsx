// Presentational controls for video quick preview playback and volume.
import type { ChangeEvent as ReactChangeEvent, CSSProperties, RefObject } from "react";
import { PressButton } from "@/components/primitives/PressButton";
import { QuickPreviewTimeline } from "./QuickPreviewTimeline";

type PreviewControlsProps = {
  open: boolean;
  visible: boolean;
  disabled: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoPaused: boolean;
  volumePickerOpen: boolean;
  volumeLabel: string;
  videoVolume: number;
  volumeStyle: CSSProperties;
  volumeButtonRef: RefObject<HTMLButtonElement | null>;
  volumeRangeRef: RefObject<HTMLInputElement | null>;
  onTogglePlayback: () => void;
  onToggleVolumePicker: () => void;
  onVolumeHoverStart: () => void;
  onVolumeHoverEnd: () => void;
  onVolumeChange: (event: ReactChangeEvent<HTMLInputElement>) => void;
  onVolumePointerDown: () => void;
  onVolumePointerUp: () => void;
  onVolumeBlur: () => void;
};

export const PreviewControls = ({
  open,
  visible,
  disabled,
  videoRef,
  videoPaused,
  volumePickerOpen,
  volumeLabel,
  videoVolume,
  volumeStyle,
  volumeButtonRef,
  volumeRangeRef,
  onTogglePlayback,
  onToggleVolumePicker,
  onVolumeHoverStart,
  onVolumeHoverEnd,
  onVolumeChange,
  onVolumePointerDown,
  onVolumePointerUp,
  onVolumeBlur,
}: PreviewControlsProps) => {
  if (!visible) return null;
  return (
    <div className="quick-preview-controls">
      <PressButton
        type="button"
        className="quick-preview-control-button quick-preview-control-button--playback"
        onClick={onTogglePlayback}
      >
        {videoPaused ? "Play" : "Pause"}
      </PressButton>
      <div
        className="quick-preview-control-volume"
        data-open={volumePickerOpen ? "true" : "false"}
        onMouseEnter={onVolumeHoverStart}
        onMouseLeave={onVolumeHoverEnd}
      >
        <PressButton
          type="button"
          className="quick-preview-control-button quick-preview-control-volume-button"
          onClick={onToggleVolumePicker}
          ref={volumeButtonRef}
          aria-expanded={volumePickerOpen ? "true" : "false"}
          aria-controls="quick-preview-volume-range"
          aria-label={`Preview volume ${volumeLabel}`}
        >
          {volumeLabel}
        </PressButton>
        <div className="quick-preview-control-volume-slider" style={volumeStyle}>
          <input
            ref={volumeRangeRef}
            id="quick-preview-volume-range"
            className="quick-preview-control-range"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={videoVolume}
            onChange={onVolumeChange}
            onPointerDown={onVolumePointerDown}
            onPointerUp={onVolumePointerUp}
            onPointerCancel={onVolumePointerUp}
            onBlur={onVolumeBlur}
            aria-label="Preview volume"
            disabled={!volumePickerOpen}
          />
        </div>
      </div>
      <QuickPreviewTimeline videoRef={videoRef} open={open} disabled={disabled} />
    </div>
  );
};
