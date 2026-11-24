// Pure state shaping for the quick preview overlay. This keeps labels and
// UI-friendly values testable without rendering the preview stack.
import type { CSSProperties } from "react";
import {
  formatBytes,
  formatCount,
  formatDate,
  getPathName,
  splitNameExtension,
} from "@/lib";
import type { EntryMeta } from "@/types";

export type QuickPreviewLoadState = "loading" | "ready" | "error";
export type PreviewMediaKind = "image" | "video" | "audio";

type BuildQuickPreviewDerivedStateParams = {
  open: boolean;
  path: string | null;
  src: string;
  kind: PreviewMediaKind;
  meta?: EntryMeta | null;
  thumbnails: Map<string, string>;
  zoom: number;
  loadState: QuickPreviewLoadState;
  loadedSrc: string | null;
  mediaSize: { width: number; height: number } | null;
  mediaVolume: number;
  canUseExternalActions: boolean;
};

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

export const buildQuickPreviewDerivedState = ({
  open,
  path,
  src,
  kind,
  meta,
  thumbnails,
  zoom,
  loadState,
  loadedSrc,
  mediaSize,
  mediaVolume,
  canUseExternalActions,
}: BuildQuickPreviewDerivedStateParams) => {
  const label = !open || !path ? "Media preview" : getPathName(path) || "Media preview";

  const isReady = loadState === "ready" && loadedSrc === src;
  const isLoading = loadState === "loading" || (!isReady && loadState !== "error");
  const hasError = loadState === "error";
  const name = getPathName(path ?? "");
  const extension = splitNameExtension(name).extension;
  const kindLabel = kind === "audio" ? "Audio" : kind === "video" ? "Video" : "Image";
  const typeLabel = extension ? extension.toUpperCase() : kindLabel;
  const sizeLabel = formatBytes(meta?.size ?? null);
  const modifiedLabel = meta?.modified == null ? "-" : formatDate(meta.modified);
  const dimensionLabel = mediaSize
    ? `${formatCount(mediaSize.width)} x ${formatCount(mediaSize.height)}`
    : "...";
  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const videoPoster = kind === "video" && path ? thumbnails.get(path) : undefined;
  const volumeLabel = `${Math.round(mediaVolume * 100)}%`;
  const titleText = name || kindLabel;
  const volumeProgress = clamp(mediaVolume * 100, 0, 100);
  const volumeStyle = {
    "--preview-volume-progress": `${volumeProgress}%`,
  } as CSSProperties;
  const mediaStyle = mediaSize
    ? {
        width: `${mediaSize.width}px`,
        height: `${mediaSize.height}px`,
        maxWidth: "none",
        maxHeight: "none",
        transform: `scale(${zoom})`,
      }
    : { transform: `scale(${zoom})` };

  return {
    src,
    label,
    kind,
    isReady,
    isLoading,
    hasError,
    titleText,
    name,
    typeLabel,
    sizeLabel,
    modifiedLabel,
    dimensionLabel,
    zoomLabel,
    videoPoster,
    volumeLabel,
    volumeStyle,
    mediaStyle,
    canUseExternalActions,
  };
};
