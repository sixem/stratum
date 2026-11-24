// Presentational stage for the main quick preview media surface.
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
  SyntheticEvent as ReactSyntheticEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { FileTypeIcon } from "@/components/icons";
import { getExtension } from "@/lib";
import { PreviewPlaybackMedia } from "./PreviewPlaybackMedia";
import type { PreviewMediaKind } from "./quickPreviewDerivedState";

type PreviewStageProps = {
  src: string;
  label: string;
  kind: PreviewMediaKind;
  analyseAudio: boolean;
  playbackKey: string;
  videoAutoplay: boolean;
  isReady: boolean;
  dragging: boolean;
  transforming: boolean;
  videoPoster?: string;
  mediaStyle: CSSProperties;
  mediaVolume: number;
  offset: { x: number; y: number };
  stageRef: RefObject<HTMLDivElement | null>;
  mediaRef: RefObject<HTMLMediaElement | null>;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onImageLoad: (event: ReactSyntheticEvent<HTMLImageElement>) => void;
  onPlaybackMetadata: (event: ReactSyntheticEvent<HTMLMediaElement>) => void;
  onPlaybackPlay: () => void;
  onPlaybackPause: () => void;
  onMediaError: () => void;
  errorContent: ReactNode;
};

export const PreviewStage = ({
  src,
  label,
  kind,
  analyseAudio,
  playbackKey,
  videoAutoplay,
  isReady,
  dragging,
  transforming,
  videoPoster,
  mediaStyle,
  mediaVolume,
  offset,
  stageRef,
  mediaRef,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onImageLoad,
  onPlaybackMetadata,
  onPlaybackPlay,
  onPlaybackPause,
  onMediaError,
  errorContent,
}: PreviewStageProps) => {
  const isAudio = kind === "audio";
  return (
    <div
      className={`quick-preview-stage${dragging ? " is-dragging" : ""}${
        transforming ? " is-transforming" : ""
      }`}
      ref={stageRef}
      data-media-kind={kind}
      onWheel={isAudio ? undefined : onWheel}
      onPointerDown={isAudio ? undefined : onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="quick-preview-pan"
        style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
      >
        {isAudio && isReady ? (
          <div className="quick-preview-audio">
            <FileTypeIcon className="quick-preview-audio-icon" isDir={false} fileKind="audio" extension={getExtension(label)} />
          </div>
        ) : null}
        {!src ? null : kind !== "image" ? (
          <PreviewPlaybackMedia
            key={playbackKey}
            src={src}
            audio={isAudio}
            analyseAudio={analyseAudio}
            ready={isReady}
            videoAutoplay={videoAutoplay}
            videoPoster={videoPoster}
            mediaStyle={mediaStyle}
            mediaVolume={mediaVolume}
            mediaRef={mediaRef}
            onMetadata={onPlaybackMetadata}
            onPlay={onPlaybackPlay}
            onPause={onPlaybackPause}
            onError={onMediaError}
          />
        ) : (
          <img
            key={src}
            className="quick-preview-media is-image"
            src={src}
            alt={label}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onLoad={onImageLoad}
            onError={onMediaError}
            data-ready={isReady ? "true" : "false"}
            style={mediaStyle}
          />
        )}
      </div>
      {errorContent}
    </div>
  );
};
