// Shared playback controls for audio and video previews.
import type { ChangeEvent as ReactChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { PauseIcon, PlayIcon } from "@/components/icons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton } from "@/components/primitives/PressButton";
import { QuickPreviewTimeline } from "./QuickPreviewTimeline";

type PreviewControlsProps = {
  open: boolean;
  visible: boolean;
  disabled: boolean;
  mediaRef: RefObject<HTMLMediaElement | null>;
  mediaKey: string;
  mediaPaused: boolean;
  volumePickerOpen: boolean;
  volumeLabel: string;
  mediaVolume: number;
  volumeStyle: CSSProperties;
  volumeRangeRef: RefObject<HTMLInputElement | null>;
  onTogglePlayback: () => void;
  onToggleVolumePicker: () => void;
  onVolumeHoverStart: () => void;
  onVolumeHoverEnd: () => void;
  onVolumeChange: (event: ReactChangeEvent<HTMLInputElement>) => void;
  onVolumePointerDown: () => void;
  onVolumePointerUp: (event: ReactPointerEvent<HTMLInputElement>) => void;
  onVolumeBlur: () => void;
};

export const PreviewControls = ({
  open,
  visible,
  disabled,
  mediaRef,
  mediaKey,
  mediaPaused,
  volumePickerOpen,
  volumeLabel,
  mediaVolume,
  volumeStyle,
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
  const playbackLabel = mediaPaused ? "Play" : "Pause";
  const PlaybackIcon = mediaPaused ? PlayIcon : PauseIcon;
  return (
    <div className="quick-preview-controls">
      <TooltipWrapper text={playbackLabel} disabled={disabled}>
        <PressButton
          type="button"
          className="quick-preview-control-button quick-preview-control-button--playback"
          aria-label={playbackLabel}
          disabled={disabled}
          onClick={onTogglePlayback}
        >
          <PlaybackIcon className="quick-preview-playback-icon" />
        </PressButton>
      </TooltipWrapper>
      <QuickPreviewTimeline mediaRef={mediaRef} mediaKey={mediaKey} open={open} disabled={disabled} />
      <div
        className="quick-preview-control-volume"
        data-open={volumePickerOpen ? "true" : "false"}
        onMouseEnter={onVolumeHoverStart}
        onMouseLeave={onVolumeHoverEnd}
      >
        <PressButton
          type="button"
          className="quick-preview-control-button quick-preview-control-volume-button tnum"
          onClick={onToggleVolumePicker}
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
            value={mediaVolume}
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
    </div>
  );
};
