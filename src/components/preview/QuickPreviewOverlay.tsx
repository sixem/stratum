// Full-screen media preview overlay composed from focused hooks and view blocks.
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { PREVIEW_STRIP_OPEN_KEY } from "@/constants/settings";
import { getFileKind, getPathName, isPreviewableEntry, normalizePath } from "@/lib";
import type { EntryMeta, FileEntry, RequestScopedThumbnails } from "@/types";
import { LoadingIndicator } from "@/components/primitives/LoadingIndicator";
import { QuickPreviewFooter } from "./QuickPreviewFooter";
import { QuickPreviewStrip } from "./QuickPreviewStrip";
import { QuickPreviewTopBar } from "./QuickPreviewTopBar";
import { PreviewControls } from "./PreviewControls";
import { PreviewError } from "./PreviewError";
import { PreviewStage } from "./PreviewStage";
import { useQuickPreviewInput } from "./useQuickPreviewInput";
import { useQuickPreviewMedia } from "./useQuickPreviewMedia";

const readPreviewStripOpen = () => {
  try {
    return globalThis.localStorage?.getItem(PREVIEW_STRIP_OPEN_KEY) !== "false";
  } catch {
    return true;
  }
};

export type QuickPreviewOverlayProps = {
  open: boolean;
  path: string | null;
  meta?: EntryMeta | null;
  items: FileEntry[];
  entryMeta: Map<string, EntryMeta>;
  thumbnails: Map<string, string>;
  thumbnailsEnabled: boolean;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  onRequestThumbs: RequestScopedThumbnails;
  thumbResetKey?: string;
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
  onSelectPreview,
  smartTabJump,
  smartTabBlocked,
}: QuickPreviewOverlayContentProps) => {
  const [stripOpen, setStripOpen] = useState(readPreviewStripOpen);
  const stripId = useId();
  const stripToggleRef = useRef<HTMLButtonElement>(null);
  const previewPathIsVideo = useMemo(() => {
    return getFileKind(getPathName(path)) === "video";
  }, [path]);
  const activePathKey = useMemo(() => normalizePath(path), [path]);
  const previewItems = useMemo(() => items.filter(isPreviewableEntry), [items]);

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
    stripOpen,
    previewItems,
    activePath: path,
    onSelectPreview,
    smartTabJump,
    smartTabBlocked,
  });

  const preview = useQuickPreviewMedia({
    open,
    path,
    meta,
    thumbnails,
    zoom,
    videoRef,
    resetViewport,
    fitMediaToViewport,
  });
  const activePreviewIndex = useMemo(() => {
    const strictIndex = previewItems.findIndex((entry) => entry.path === path);
    if (strictIndex >= 0) return strictIndex;
    return previewItems.findIndex((entry) => normalizePath(entry.path) === activePathKey);
  }, [activePathKey, path, previewItems]);
  const canGoPreviewBack = activePreviewIndex > 0;
  const canGoPreviewForward = activePreviewIndex >= 0 && activePreviewIndex < previewItems.length - 1;
  const showPreviewNavigation = previewItems.length > 1;
  const previewPositionLabel = showPreviewNavigation
    ? `${Math.max(activePreviewIndex + 1, 1)} / ${previewItems.length}`
    : null;
  const handleGoPreviewBack = useCallback(() => {
    if (!canGoPreviewBack) return;
    const previous = previewItems[activePreviewIndex - 1];
    if (!previous) return;
    onSelectPreview(previous.path);
  }, [activePreviewIndex, canGoPreviewBack, onSelectPreview, previewItems]);
  const handleGoPreviewForward = useCallback(() => {
    if (!canGoPreviewForward) return;
    const next = previewItems[activePreviewIndex + 1];
    if (!next) return;
    onSelectPreview(next.path);
  }, [activePreviewIndex, canGoPreviewForward, onSelectPreview, previewItems]);

  const handleToggleStrip = () => {
    const next = !stripOpen;
    setStripOpen(next);
    try {
      globalThis.localStorage?.setItem(PREVIEW_STRIP_OPEN_KEY, String(next));
    } catch {
      // The current gallery can still be toggled if storage is unavailable.
    }
  };

  return (
    <div
      className="quick-preview"
      data-open={open ? "true" : "false"}
      data-strip-open={stripOpen}
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={preview.label}
      tabIndex={-1}
      onKeyDown={(event) => {
        // Reach the last control from the dialog even when Smart Tab owns forward Tab.
        if (
          event.key === "Tab" && event.shiftKey &&
          !event.altKey && !event.ctrlKey && !event.metaKey &&
          event.target === event.currentTarget
        ) {
          event.preventDefault();
          stripToggleRef.current?.focus();
        }
      }}
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
        videoAutoplay={preview.videoAutoplay}
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
      <div className="quick-preview-strip-panel" id={stripId} hidden={!stripOpen}>
        {stripOpen ? (
          <QuickPreviewStrip
            open={open}
            items={previewItems}
            activePath={path}
            entryMeta={entryMeta}
            thumbnails={thumbnails}
            thumbnailsEnabled={thumbnailsEnabled}
            onRequestMeta={onRequestMeta}
            onRequestThumbs={onRequestThumbs}
            thumbResetKey={thumbResetKey}
            onSelect={onSelectPreview}
            stripRef={stripRef}
          />
        ) : null}
      </div>
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
      <QuickPreviewFooter
        preview={preview}
        stripOpen={stripOpen}
        stripId={stripId}
        stripToggleRef={stripToggleRef}
        onToggleStrip={handleToggleStrip}
      />
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
