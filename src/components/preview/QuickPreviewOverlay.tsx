// Full-screen media preview overlay composed from focused hooks and view blocks.
import { useCallback, useMemo } from "react";
import { getFileKind, getPathName, normalizePath } from "@/lib";
import type { EntryMeta, FileEntry, ThumbnailRequest } from "@/types";
import { LoadingIndicator } from "@/components/primitives/LoadingIndicator";
import { QuickPreviewStrip } from "./QuickPreviewStrip";
import { QuickPreviewTopBar } from "./QuickPreviewTopBar";
import { PreviewControls } from "./PreviewControls";
import { PreviewError } from "./PreviewError";
import { PreviewStage } from "./PreviewStage";
import { useQuickPreviewInput } from "./useQuickPreviewInput";
import { useQuickPreviewMedia } from "./useQuickPreviewMedia";

export type QuickPreviewOverlayProps = {
  open: boolean;
  path: string | null;
  meta?: EntryMeta | null;
  items: FileEntry[];
  entryMeta: Map<string, EntryMeta>;
  thumbnails: Map<string, string>;
  thumbnailsEnabled: boolean;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  onRequestThumbs: (requests: ThumbnailRequest[]) => void;
  thumbResetKey?: string;
  loading: boolean;
  onSelectPreview: (path: string) => void;
  smartTabJump: boolean;
  smartTabBlocked: boolean;
};

type QuickPreviewOverlayContentProps = Omit<QuickPreviewOverlayProps, "path"> & {
  path: string;
};

const QuickPreviewOverlayContent = ({
  open,
  path,
  meta,
  items,
  entryMeta,
  thumbnails,
  thumbnailsEnabled,
  onRequestMeta,
  onRequestThumbs,
  thumbResetKey,
  loading,
  onSelectPreview,
  smartTabJump,
  smartTabBlocked,
}: QuickPreviewOverlayContentProps) => {
  const previewPathIsVideo = useMemo(() => {
    return getFileKind(getPathName(path)) === "video";
  }, [path]);
  const activePathKey = useMemo(() => normalizePath(path), [path]);

  const {
    containerRef,
    stageRef,
    stripRef,
    videoRef,
    zoom,
    offset,
    dragging,
    transforming,
    resetViewport,
    fitMediaToViewport,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  } = useQuickPreviewInput({
    open,
    isVideo: previewPathIsVideo,
    items,
    activePath: path,
    onSelectPreview,
    smartTabJump,
    smartTabBlocked,
  });

  const preview = useQuickPreviewMedia({
    open,
    path,
    meta,
    items,
    thumbnails,
    zoom,
    videoRef,
    resetViewport,
    fitMediaToViewport,
  });
  const activePreviewIndex = useMemo(() => {
    const strictIndex = preview.previewItems.findIndex((entry) => entry.path === path);
    if (strictIndex >= 0) return strictIndex;
    return preview.previewItems.findIndex((entry) => normalizePath(entry.path) === activePathKey);
  }, [activePathKey, path, preview.previewItems]);
  const canGoPreviewBack = activePreviewIndex > 0;
  const canGoPreviewForward =
    activePreviewIndex >= 0 && activePreviewIndex < preview.previewItems.length - 1;
  const showPreviewNavigation = preview.previewItems.length > 1;
  const previewPositionLabel =
    showPreviewNavigation && preview.previewItems.length > 0
      ? `${Math.max(activePreviewIndex + 1, 1)} / ${preview.previewItems.length}`
      : null;
  const handleGoPreviewBack = useCallback(() => {
    if (!canGoPreviewBack) return;
    const previous = preview.previewItems[activePreviewIndex - 1];
    if (!previous) return;
    onSelectPreview(previous.path);
  }, [activePreviewIndex, canGoPreviewBack, onSelectPreview, preview.previewItems]);
  const handleGoPreviewForward = useCallback(() => {
    if (!canGoPreviewForward) return;
    const next = preview.previewItems[activePreviewIndex + 1];
    if (!next) return;
    onSelectPreview(next.path);
  }, [activePreviewIndex, canGoPreviewForward, onSelectPreview, preview.previewItems]);

  return (
    <div
      className="quick-preview"
      data-open={open ? "true" : "false"}
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={preview.label}
      tabIndex={-1}
    >
      <QuickPreviewTopBar
        title={preview.titleText}
        positionLabel={previewPositionLabel}
        showNavigation={showPreviewNavigation}
        canGoBack={canGoPreviewBack}
        canGoForward={canGoPreviewForward}
        onGoBack={handleGoPreviewBack}
        onGoForward={handleGoPreviewForward}
      />
      <PreviewStage
        src={preview.src}
        label={preview.label}
        isVideo={preview.isVideo}
        isReady={preview.isReady}
        dragging={dragging}
        transforming={transforming}
        videoPoster={preview.videoPoster}
        mediaStyle={preview.mediaStyle}
        offset={offset}
        stageRef={stageRef}
        videoRef={videoRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onImageLoad={preview.handleImageLoad}
        onVideoMetadata={preview.handleVideoMetadata}
        onVideoPlay={preview.handleVideoPlay}
        onVideoPause={preview.handleVideoPause}
        onMediaError={preview.handleMediaError}
        errorContent={
          <PreviewError
            visible={preview.hasError}
            isVideo={preview.isVideo}
            name={preview.name}
            typeLabel={preview.typeLabel}
            canUseExternalActions={preview.canUseExternalActions}
            externalActionError={preview.externalActionError}
            onOpenExternal={preview.handleOpenExternal}
            onRevealExternal={preview.handleRevealExternal}
          />
        }
      />
      <QuickPreviewStrip
        open={open}
        items={preview.previewItems}
        activePath={path}
        entryMeta={entryMeta}
        thumbnails={thumbnails}
        thumbnailsEnabled={thumbnailsEnabled}
        onRequestMeta={onRequestMeta}
        onRequestThumbs={onRequestThumbs}
        thumbResetKey={thumbResetKey}
        loading={loading}
        onSelect={onSelectPreview}
        stripRef={stripRef}
      />
      <div className="quick-preview-loading" data-visible={preview.isLoading ? "true" : "false"}>
        <div className="quick-preview-loading-card">
          <LoadingIndicator label={preview.isVideo ? "Loading video" : "Loading image"} />
        </div>
      </div>
      <PreviewControls
        open={open}
        visible={preview.isVideo}
        disabled={preview.loadState === "error"}
        videoRef={videoRef}
        videoPaused={preview.videoPaused}
        volumePickerOpen={preview.volumePickerOpen}
        volumeLabel={preview.volumeLabel}
        videoVolume={preview.videoVolume}
        volumeStyle={preview.volumeStyle}
        volumeButtonRef={preview.volumeButtonRef}
        volumeRangeRef={preview.volumeRangeRef}
        onTogglePlayback={preview.handleTogglePlayback}
        onToggleVolumePicker={preview.handleToggleVolumePicker}
        onVolumeHoverStart={preview.handleVolumeHoverStart}
        onVolumeHoverEnd={preview.handleVolumeHoverEnd}
        onVolumeChange={preview.handleVolumeChange}
        onVolumePointerDown={preview.handleVolumePointerDown}
        onVolumePointerUp={preview.handleVolumePointerUp}
        onVolumeBlur={() => preview.scheduleVolumePickerClose(220)}
      />
      <div className="quick-preview-info" aria-live="polite">
        {preview.hasError ? (
          <div className="quick-preview-info-error" role="status">
            Preview unavailable. Try opening the file externally.
          </div>
        ) : null}
        <div className="quick-preview-info-row">
          <div className="quick-preview-info-item">
            <span className="quick-preview-info-label">Type</span>
            <span className="quick-preview-info-value">{preview.typeLabel}</span>
          </div>
          <div className="quick-preview-info-item">
            <span className="quick-preview-info-label">Dimensions</span>
            <span className="quick-preview-info-value">{preview.dimensionLabel}</span>
          </div>
          <div className="quick-preview-info-item">
            <span className="quick-preview-info-label">Size</span>
            <span className="quick-preview-info-value">{preview.sizeLabel}</span>
          </div>
          <div className="quick-preview-info-item">
            <span className="quick-preview-info-label">Modified</span>
            <span className="quick-preview-info-value">{preview.modifiedLabel}</span>
          </div>
          <div className="quick-preview-info-item">
            <span className="quick-preview-info-label">Zoom</span>
            <span className="quick-preview-info-value">{preview.zoomLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const QuickPreviewOverlay = (props: QuickPreviewOverlayProps) => {
  const { open, path } = props;
  // Avoid running preview hooks when the overlay is closed.
  if (!open || !path) {
    return null;
  }
  return <QuickPreviewOverlayContent {...props} path={path} />;
};
