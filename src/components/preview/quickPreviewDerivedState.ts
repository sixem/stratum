// Pure state shaping for the quick preview overlay. This keeps labels, preview
// lists, and UI-friendly values testable without rendering the preview stack.
import type { CSSProperties } from "react";
import {
  formatBytes,
  formatCount,
  formatDate,
  getFileKind,
  getPathName,
  splitNameExtension,
} from "@/lib";
import type { EntryMeta, FileEntry } from "@/types";

export type QuickPreviewLoadState = "loading" | "ready" | "error";

type BuildQuickPreviewDerivedStateParams = {
  open: boolean;
  path: string | null;
  src: string;
  isVideo: boolean;
  meta?: EntryMeta | null;
  items: FileEntry[];
  thumbnails: Map<string, string>;
  zoom: number;
  loadState: QuickPreviewLoadState;
  loadedSrc: string | null;
  mediaSize: { width: number; height: number } | null;
  videoVolume: number;
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
  isVideo,
  meta,
  items,
  thumbnails,
  zoom,
  loadState,
  loadedSrc,
  mediaSize,
  videoVolume,
  canUseExternalActions,
}: BuildQuickPreviewDerivedStateParams) => {
  const label = !open || !path ? "Media preview" : getPathName(path) || "Media preview";
  const previewItems = !open
    ? []
    : items.filter((entry) => {
        if (entry.isDir) return false;
        const kind = getFileKind(entry.name);
        return kind === "image" || kind === "video";
      });

  const isReady = loadState === "ready" && loadedSrc === src;
  const isLoading = loadState === "loading" || (!isReady && loadState !== "error");
  const hasError = loadState === "error";
  const name = getPathName(path ?? "");
  const extension = splitNameExtension(name).extension;
  const typeLabel = extension ? extension.toUpperCase() : isVideo ? "Video" : "Image";
  const sizeLabel = formatBytes(meta?.size ?? null);
  const modifiedLabel = meta?.modified == null ? "-" : formatDate(meta.modified);
  const dimensionLabel = mediaSize
    ? `${formatCount(mediaSize.width)} x ${formatCount(mediaSize.height)}`
    : "...";
  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const videoPoster = isVideo && path ? thumbnails.get(path) : undefined;
  const volumeLabel = `${Math.round(videoVolume * 100)}%`;
  const titleText = name || (isVideo ? "Video" : "Image");
  const volumeProgress = clamp(videoVolume * 100, 0, 100);
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
    isVideo,
    previewItems,
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
