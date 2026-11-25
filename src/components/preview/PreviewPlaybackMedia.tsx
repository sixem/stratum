// Keep exactly one playback element attached to the current preview grant.
import { useCallback, useEffect, useLayoutEffect } from "react";
import type { CSSProperties, RefObject, SyntheticEvent } from "react";
import { AudioPreviewSpectrum } from "./AudioPreviewSpectrum";
import { cancelPreviewSeek } from "./previewSeek";

type Props = {
  src: string;
  audio: boolean;
  analyseAudio: boolean;
  ready: boolean;
  mediaAutoplay: boolean;
  videoPoster?: string;
  mediaStyle: CSSProperties;
  mediaVolume: number;
  mediaRef: RefObject<HTMLMediaElement | null>;
  onMetadata: (event: SyntheticEvent<HTMLMediaElement>) => void;
  onPlay: () => void;
  onPause: () => void;
  onError: () => void;
};

export const PreviewPlaybackMedia = ({
  src, audio, analyseAudio, ready, mediaAutoplay, videoPoster, mediaStyle, mediaVolume, mediaRef,
  onMetadata, onPlay, onPause, onError,
}: Props) => {
  const attach = useCallback((element: HTMLMediaElement | null) => {
    mediaRef.current = element;
  }, [mediaRef]);

  useLayoutEffect(() => {
    if (mediaRef.current) mediaRef.current.volume = mediaVolume;
  }, [mediaRef, mediaVolume]);

  useLayoutEffect(() => {
    const element = mediaRef.current;
    if (!element) return;
    element.src = src;
    return () => {
      cancelPreviewSeek(element);
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [mediaRef, src]);

  useEffect(() => {
    const element = mediaRef.current;
    if (mediaAutoplay && element?.paused) void element.play().catch(() => {});
  }, [mediaAutoplay, mediaRef, src]);

  const events = { onLoadedMetadata: onMetadata, onPlay, onPause, onEnded: onPause, onError };
  return audio ? (
    <>
      <audio
        ref={attach}
        hidden
        preload="metadata"
        autoPlay={mediaAutoplay}
        crossOrigin={analyseAudio ? "anonymous" : undefined}
        {...events}
      />
      {analyseAudio ? <AudioPreviewSpectrum mediaRef={mediaRef} /> : null}
    </>
  ) : (
    <video
      ref={attach}
      className="quick-preview-media is-video"
      poster={videoPoster}
      playsInline
      preload="metadata"
      autoPlay={mediaAutoplay}
      loop
      draggable={false}
      data-ready={ready ? "true" : "false"}
      style={mediaStyle}
      {...events}
    />
  );
};
