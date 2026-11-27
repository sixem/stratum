// Full-screen media preview overlay composed from focused hooks and view blocks.
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { PREVIEW_STRIP_OPEN_KEY } from "@/constants/settings";
import { getFileKind, getPathName, isPreviewableEntry } from "@/lib";
import type { EntryMeta, EntryMetaLookup, FileEntry, RequestScopedThumbnails, ThumbnailLookup } from "@/types";
import { useSettingsStore } from "@/modules";
import { QuickPreviewFooter } from "./QuickPreviewFooter";
import { QuickPreviewStrip } from "./QuickPreviewStrip";
import { QuickPreviewTopBar } from "./QuickPreviewTopBar";
import { PreviewControls } from "./PreviewControls";
import { PreviewError } from "./PreviewError";
import { PreviewStage } from "./PreviewStage";
import { useQuickPreviewInput } from "./useQuickPreviewInput";
import { useQuickPreviewMedia } from "./useQuickPreviewMedia";
import { createPreviewPositionLookup } from "./previewPosition";

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
  remote?: { profileId: string; sessionId: number };
  meta?: EntryMeta | null;
  items: FileEntry[];
  entryMeta: EntryMetaLookup;
  thumbnails: ThumbnailLookup;
  thumbnailsEnabled: boolean;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  onRequestThumbs: RequestScopedThumbnails;
  thumbResetKey?: string;
  onSelectPreview: (path: string) => void;
  onClose: () => void;
  smartTabJump: boolean;
  smartTabBlocked: boolean;
};

type QuickPreviewOverlayContentProps = Omit<QuickPreviewOverlayProps, "path"> & {
  path: string;
};

const QuickPreviewOverlayContent = ({
  open,
  path,
  remote,
  meta,
  items,
  entryMeta,
  thumbnails,
  thumbnailsEnabled,
  onRequestMeta,
  onRequestThumbs,
  thumbResetKey,
  onSelectPreview,
  onClose,
  smartTabJump,
  smartTabBlocked,
}: QuickPreviewOverlayContentProps) => {
  const [stripOpen, setStripOpen] = useState(readPreviewStripOpen);
  const stripId = useId();
  const returnButtonRef = useRef<HTMLButtonElement>(null);
  const includeAudio = useSettingsStore((state) => state.galleryAudio);
  const fileKind = getFileKind(getPathName(path));
  const kind = fileKind === "audio" || fileKind === "video" ? fileKind : "image";
  const playable = kind !== "image";
  const previewItems = useMemo(
    () => items.filter((entry) => isPreviewableEntry(entry, includeAudio)),
    [includeAudio, items],
  );
  const getPreviewPosition = useMemo(() => createPreviewPositionLookup(previewItems), [previewItems]);
  const activePreviewIndex = useMemo(() => getPreviewPosition(path), [getPreviewPosition, path]);

  const {
    containerRef,
    stageRef,
    stripRef,
    mediaRef,
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
    playable,
    stripOpen,
    previewItems,
    activeIndex: activePreviewIndex,
    activePath: path,
    onSelectPreview,
    smartTabJump,
    smartTabBlocked,
  });

  const preview = useQuickPreviewMedia({
    open,
    path,
    remote,
    kind,
    meta,
    thumbnails,
    zoom,
    mediaRef,
    resetViewport,
    fitMediaToViewport,
  });
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
      onPointerDownCapture={(event) => {
        if (event.button === 0 && event.currentTarget !== document.activeElement) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onMouseDownCapture={(event) => {
        // Pointer clicks still activate buttons without taking keyboard focus.
        if (event.button === 0 && event.target instanceof Element && event.target.closest("button")) {
          event.preventDefault();
        }
      }}
      onKeyDown={(event) => {
        if (
          playable && event.key === " " && !event.shiftKey &&
          !event.altKey && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) preview.handleTogglePlayback();
          return;
        }
        if ((event.key === "Enter" || event.key === " ") && event.target instanceof Element && event.target.closest("button")) {
          event.stopPropagation();
        }
        // Reach the last control from the dialog even when Smart Tab owns forward Tab.
        if (
          event.key === "Tab" && event.shiftKey &&
          !event.altKey && !event.ctrlKey && !event.metaKey &&
          event.target === event.currentTarget
        ) {
          event.preventDefault();
          returnButtonRef.current?.focus();
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
        kind={preview.kind}
        analyseAudio={preview.analyseAudio}
        playbackKey={preview.playbackKey}
        mediaAutoplay={preview.mediaAutoplay}
        isReady={preview.isReady}
        isLoading={preview.isLoading}
        dragging={dragging}
        transforming={transforming}
        videoPoster={preview.videoPoster}
        mediaStyle={preview.mediaStyle}
        mediaVolume={preview.mediaVolume}
        offset={offset}
        stageRef={stageRef}
        mediaRef={mediaRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onImageLoad={preview.handleImageLoad}
        imageCrossOrigin={preview.imageCrossOrigin}
        onPlaybackMetadata={preview.handlePlaybackMetadata}
        onPlaybackPlay={preview.handlePlaybackPlay}
        onPlaybackPause={preview.handlePlaybackPause}
        onMediaError={preview.handleMediaError}
        errorContent={
          <PreviewError
            visible={preview.hasError}
            kind={preview.kind}
            name={preview.name}
            typeLabel={preview.typeLabel}
            canUseExternalActions={preview.canUseExternalActions}
            canRevealExternal={preview.canRevealExternal}
            externalActionError={preview.externalActionError}
            onOpenExternal={preview.handleOpenExternal}
            onRevealExternal={preview.handleRevealExternal}
          />
        }
      />
      <div className="quick-preview-strip-panel" id={stripId} hidden={!stripOpen}>
        {stripOpen ? (
          <QuickPreviewStrip
            remote={remote}
            open={open}
            items={previewItems}
            activeIndex={activePreviewIndex}
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
      <PreviewControls
        open={open}
        visible={playable}
        disabled={!preview.src || preview.hasError}
        mediaRef={mediaRef}
        mediaKey={preview.playbackKey}
        mediaPaused={preview.mediaPaused}
        volumePickerOpen={preview.volumePickerOpen}
        volumeLabel={preview.volumeLabel}
        mediaVolume={preview.mediaVolume}
        volumeStyle={preview.volumeStyle}
        volumeRangeRef={preview.volumeRangeRef}
        onTogglePlayback={preview.handleTogglePlayback}
        onToggleVolumePicker={preview.handleToggleVolumePicker}
        onVolumeHoverStart={preview.handleVolumeHoverStart}
        onVolumeHoverEnd={preview.handleVolumeHoverEnd}
        onVolumeChange={preview.handleVolumeChange}
        onVolumePointerDown={preview.handleVolumePointerDown}
        onVolumePointerUp={(event) => {
          if (document.activeElement === event.currentTarget) {
            containerRef.current?.focus({ preventScroll: true });
          }
          preview.handleVolumePointerUp();
        }}
        onVolumeBlur={() => preview.scheduleVolumePickerClose(220)}
      />
      <QuickPreviewFooter
        preview={preview}
        stripOpen={stripOpen}
        stripId={stripId}
        returnButtonRef={returnButtonRef}
        onToggleStrip={handleToggleStrip}
        onClose={onClose}
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
