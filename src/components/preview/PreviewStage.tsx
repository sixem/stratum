// Presentational stage for the main quick preview media surface.
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
  SyntheticEvent as ReactSyntheticEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

type PreviewStageProps = {
  src: string;
  label: string;
  isVideo: boolean;
  isReady: boolean;
  dragging: boolean;
  transforming: boolean;
  videoPoster?: string;
  mediaStyle: CSSProperties;
  offset: { x: number; y: number };
  stageRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onImageLoad: (event: ReactSyntheticEvent<HTMLImageElement>) => void;
  onVideoMetadata: (event: ReactSyntheticEvent<HTMLVideoElement>) => void;
  onVideoPlay: () => void;
  onVideoPause: () => void;
  onMediaError: () => void;
  errorContent: ReactNode;
};

export const PreviewStage = ({
  src,
  label,
  isVideo,
  isReady,
  dragging,
  transforming,
  videoPoster,
  mediaStyle,
  offset,
  stageRef,
  videoRef,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onImageLoad,
  onVideoMetadata,
  onVideoPlay,
  onVideoPause,
  onMediaError,
  errorContent,
}: PreviewStageProps) => {
  return (
    <div
      className={`quick-preview-stage${dragging ? " is-dragging" : ""}${
        transforming ? " is-transforming" : ""
      }`}
      ref={stageRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="quick-preview-pan"
        style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
      >
        {isVideo ? (
          <video
            key={src}
            className="quick-preview-media is-video"
            src={src}
            poster={videoPoster}
            playsInline
            preload="metadata"
            autoPlay
            loop
            draggable={false}
            onLoadedMetadata={onVideoMetadata}
            onPlay={onVideoPlay}
            onPause={onVideoPause}
            ref={videoRef}
            onError={onMediaError}
            data-ready={isReady ? "true" : "false"}
            style={mediaStyle}
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
