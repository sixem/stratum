// Metadata + thumbnail request pipeline for the file grid.
import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useEntryMetaRequest,
  useFileIcons,
  useScrollSettled,
  useThumbnailPause,
  useThumbnailRequest,
  useTypingActivity,
} from "@/hooks";
import { getExtension, makeDebug } from "@/lib";
import type { EntryItem } from "@/lib";
import { THUMB_INTERACTION_COOLDOWN_MS, THUMB_TYPING_PAUSE_MS } from "@/constants";
import { useDirectoryChildStateRevision } from "@/modules";
import type { EntryMeta, EntryMetaLookup, ThumbnailLookup, ThumbnailRequest } from "@/types";
import { useGridDisplayMeta } from "./useGridDisplayMeta";
import type { GridDisplayMeta } from "./useGridDisplayMeta";
import { useGridFolderSamples } from "./useGridFolderSamples";
import type { FolderThumbnail } from "./useGridFolderSamples";

type UseGridThumbRequestsOptions = {
  viewportRef: RefObject<HTMLDivElement | null>;
  viewKey: string;
  visibleItems: EntryItem[];
  isResizing: boolean;
  entryMeta: EntryMetaLookup;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  thumbnailsEnabled: boolean;
  thumbnails: ThumbnailLookup;
  onRequestThumbs: (requests: ThumbnailRequest[]) => void;
  thumbResetKey?: string;
  thumbnailAppIcons: boolean;
  thumbnailFolders: boolean;
  thumbnailVideos: boolean;
  thumbnailSvgs: boolean;
  loading: boolean;
};

type GridThumbRequestsState = {
  gridMetaByPath: Map<string, GridDisplayMeta>;
  thumbSource: ThumbnailLookup;
  folderThumbSource: Map<string, FolderThumbnail>;
  fileIcons: Map<string, string | null>;
  executableIcons: Map<string, string | null>;
  scrolling: boolean;
  interactionActive: boolean;
};

const perf = makeDebug("perf:resize:enrich");

export const useGridThumbRequests = ({
  viewportRef,
  viewKey,
  visibleItems,
  isResizing,
  entryMeta,
  onRequestMeta,
  thumbnailsEnabled,
  thumbnails,
  onRequestThumbs,
  thumbResetKey,
  thumbnailAppIcons,
  thumbnailFolders,
  thumbnailVideos,
  thumbnailSvgs,
  loading,
}: UseGridThumbRequestsOptions): GridThumbRequestsState => {
  const directoryChildRevision = useDirectoryChildStateRevision();
  const scrolling = useScrollSettled(viewportRef);
  const typingActive = useTypingActivity({ resetDelayMs: THUMB_TYPING_PAUSE_MS });
  // Treat resize like scroll/typing so enrichment yields while layout is hot.
  const interactionActive = scrolling || typingActive || isResizing;
  const [thumbsSuppressed, setThumbsSuppressed] = useState(false);
  const thumbSnapshotRef = useRef(thumbnails);
  const lastSuppressedRef = useRef(false);
  const lastPipelineLogRef = useRef("");

  useEffect(() => {
    // Hide thumbnail previews briefly during/after interaction to keep scrolling smooth.
    if (interactionActive) {
      setThumbsSuppressed(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setThumbsSuppressed(false);
    }, THUMB_INTERACTION_COOLDOWN_MS);
    return () => window.clearTimeout(timer);
  }, [interactionActive]);

  useEffect(() => {
    // Freeze the current thumbnail map during suppression so loaded thumbs stay visible.
    if (thumbsSuppressed && !lastSuppressedRef.current) {
      thumbSnapshotRef.current = thumbnails;
    } else if (!thumbsSuppressed) {
      thumbSnapshotRef.current = thumbnails;
    }
    lastSuppressedRef.current = thumbsSuppressed;
  }, [thumbsSuppressed, thumbnails]);

  const { metaPaths, thumbRequests, folderPaths, executableFiles } = useMemo(() => {
    // Build the meta + thumbnail request lists in one pass to keep allocations low.
    if (visibleItems.length === 0) {
      return { metaPaths: [], thumbRequests: [], folderPaths: [], executableFiles: [] };
    }
    const nextMeta: string[] = [];
    const nextThumbs: ThumbnailRequest[] = [];
    const nextFolders: string[] = [];
    const nextExecutables: ThumbnailRequest[] = [];
    for (const item of visibleItems) {
      if (item.type !== "entry") continue;
      if (item.presence === "removed") continue;
      if (item.entry.isDir) {
        nextFolders.push(item.entry.path);
        continue;
      }
      const path = item.entry.path;
      nextMeta.push(path);
      const meta = entryMeta.get(path);
      const resolvedSize = meta?.size ?? item.entry.size ?? null;
      const resolvedModified = meta?.modified ?? item.entry.modified ?? null;
      // Provide cached size/modified so the backend can hash without extra stats.
      nextThumbs.push({
        path,
        size: resolvedSize,
        modified: resolvedModified,
      });
      if (thumbnailAppIcons && getExtension(item.entry.name) === "exe") {
        nextExecutables.push({
          path,
          size: resolvedSize,
          modified: resolvedModified,
        });
      }
    }
    return { metaPaths: nextMeta, thumbRequests: nextThumbs, folderPaths: nextFolders, executableFiles: nextExecutables };
  }, [entryMeta, thumbnailAppIcons, visibleItems]);

  const gridMetaByPath = useGridDisplayMeta({
    entryMeta,
    viewKey,
    visibleItems,
  });

  useEntryMetaRequest(loading || interactionActive, metaPaths, onRequestMeta);
  // Pause thumbnail generation while the user is actively interacting.
  useThumbnailPause(interactionActive, thumbnailsEnabled);
  const canRequestThumbs = thumbnailsEnabled && !loading && !interactionActive;
  const thumbSource = thumbsSuppressed ? thumbSnapshotRef.current : thumbnails;
  useThumbnailRequest(
    loading || interactionActive,
    canRequestThumbs,
    thumbRequests,
    onRequestThumbs,
    `${viewKey}:${thumbResetKey ?? ""}:${thumbnailsEnabled}`,
  );

  const { folderThumbRequestCount, folderThumbSource } = useGridFolderSamples({
    viewKey,
    directoryChildRevision,
    folderPaths,
    interactionActive,
    loading,
    onRequestThumbs,
    thumbnailFolders,
    thumbnailSvgs,
    thumbnailVideos,
    thumbnailsEnabled,
    thumbResetKey,
    thumbSource,
  });

  const iconRequests = useMemo(() => {
    if (!thumbnailAppIcons || visibleItems.length === 0) {
      return [];
    }
    const requests: string[] = [];
    const seen = new Set<string>();
    for (const item of visibleItems) {
      if (item.type !== "entry") continue;
      if (item.presence === "removed") continue;
      if (item.entry.isDir) continue;
      const extension = getExtension(item.entry.name);
      if (!extension || seen.has(extension)) continue;
      seen.add(extension);
      requests.push(extension);
    }
    return requests;
  }, [thumbnailAppIcons, visibleItems]);

  const { fileIcons, executableIcons } = useFileIcons(
    iconRequests, executableFiles, thumbnailAppIcons && !loading && !interactionActive,
  );

  useEffect(() => {
    if (!perf.enabled) return;
    const snapshot = [
      viewKey,
      visibleItems.length,
      metaPaths.length,
      thumbRequests.length,
      folderPaths.length,
      folderThumbRequestCount,
      iconRequests.length,
      loading ? "1" : "0",
      scrolling ? "1" : "0",
      typingActive ? "1" : "0",
      isResizing ? "1" : "0",
      interactionActive ? "1" : "0",
      thumbsSuppressed ? "1" : "0",
    ].join(":");
    if (lastPipelineLogRef.current === snapshot) return;
    lastPipelineLogRef.current = snapshot;
    perf(
      "pipeline view=%s visible=%d meta=%d thumbs=%d folders=%d folderThumbs=%d icons=%d loading=%s scrolling=%s typing=%s resizing=%s active=%s suppressed=%s",
      viewKey,
      visibleItems.length,
      metaPaths.length,
      thumbRequests.length,
      folderPaths.length,
      folderThumbRequestCount,
      iconRequests.length,
      loading ? "yes" : "no",
      scrolling ? "yes" : "no",
      typingActive ? "yes" : "no",
      isResizing ? "yes" : "no",
      interactionActive ? "yes" : "no",
      thumbsSuppressed ? "yes" : "no",
    );
  }, [
    folderPaths.length,
    folderThumbRequestCount,
    iconRequests.length,
    isResizing,
    interactionActive,
    loading,
    metaPaths.length,
    scrolling,
    thumbRequests.length,
    thumbsSuppressed,
    typingActive,
    viewKey,
    visibleItems.length,
  ]);

  return {
    gridMetaByPath,
    thumbSource,
    folderThumbSource,
    fileIcons,
    executableIcons,
    scrolling,
    interactionActive,
  };
};
