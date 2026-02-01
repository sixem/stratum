// Renders a thumbnail image while tracking readiness state.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ThumbnailPreviewProps } from "./gridCard.types";

export const ThumbnailPreview = ({ src, onReadyChange }: ThumbnailPreviewProps) => {
  const [displaySrc, setDisplaySrc] = useState(src);
  const [ready, setReady] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const loadIdRef = useRef(0);
  const lastReadyRef = useRef(ready);

  const setReadyState = useCallback((next: boolean) => {
    setReady((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    if (lastReadyRef.current === ready) return;
    lastReadyRef.current = ready;
    // Notify the parent after render to avoid setState during render warnings.
    onReadyChange?.(ready);
  }, [onReadyChange, ready]);

  useEffect(() => {
    if (!src) {
      loadIdRef.current += 1;
      setDisplaySrc("");
      setReadyState(false);
      return;
    }
    if (src === displaySrc) return;
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    const preload = new Image();
    preload.onload = () => {
      if (loadIdRef.current !== loadId) return;
      setDisplaySrc(src);
      setReadyState(true);
    };
    preload.onerror = () => {
      if (loadIdRef.current !== loadId) return;
      if (!displaySrc) {
        setReadyState(false);
      }
    };
    preload.src = src;
  }, [displaySrc, setReadyState, src]);

  useEffect(() => {
    if (!displaySrc) return;
    // Defer sync image readiness checks to avoid blocking paint during fast scrolls.
    const img = imgRef.current;
    const isReady = Boolean(img && img.complete && img.naturalWidth > 0);
    setReadyState(isReady);
  }, [displaySrc, setReadyState]);

  if (!displaySrc) return null;

  return (
    <img
      className="thumb-preview"
      src={displaySrc}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading="lazy"
      decoding="async"
      data-ready={ready ? "true" : "false"}
      ref={imgRef}
      onLoad={() => {
        setReadyState(true);
      }}
      onError={() => {
        setReadyState(false);
      }}
    />
  );
};
