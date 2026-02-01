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
import {
  buildEntryTooltip,
  formatBytes,
  getExtension,
  getFileKind,
} from "@/lib";
import type { FileKind } from "@/lib";
import type { EntryItem } from "@/lib";
import { THUMB_INTERACTION_COOLDOWN_MS, THUMB_TYPING_PAUSE_MS } from "@/constants";
import type { EntryMeta, ThumbnailRequest } from "@/types";

export type GridDisplayMeta = {
  tooltipText: string;
  fileKind: FileKind;
  extension: string | null;
  sizeLabel: string;
};

type UseGridThumbRequestsOptions = {
  viewportRef: RefObject<HTMLDivElement | null>;
  viewKey: string;
  visibleItems: EntryItem[];
  entryMeta: Map<string, EntryMeta>;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  thumbnailsEnabled: boolean;
  thumbnails: Map<string, string>;
  onRequestThumbs: (requests: ThumbnailRequest[]) => void;
  thumbResetKey?: string;
  thumbnailAppIcons: boolean;
  loading: boolean;
};

type GridThumbRequestsState = {
  gridMetaByPath: Map<string, GridDisplayMeta>;
  thumbSource: Map<string, string>;
  fileIcons: Map<string, string>;
};

export const useGridThumbRequests = ({
  viewportRef,
  viewKey,
  visibleItems,
  entryMeta,
  onRequestMeta,
  thumbnailsEnabled,
  thumbnails,
  onRequestThumbs,
  thumbResetKey,
  thumbnailAppIcons,
  loading,
}: UseGridThumbRequestsOptions): GridThumbRequestsState => {
  const scrolling = useScrollSettled(viewportRef);
  const typingActive = useTypingActivity({ resetDelayMs: THUMB_TYPING_PAUSE_MS });
  const interactionActive = scrolling || typingActive;
  const [thumbsSuppressed, setThumbsSuppressed] = useState(false);
  const thumbSnapshotRef = useRef<Map<string, string>>(new Map());
  const lastSuppressedRef = useRef(false);

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

  const { metaPaths, thumbRequests } = useMemo(() => {
    // Build the meta + thumbnail request lists in one pass to keep allocations low.
    if (visibleItems.length === 0) {
      return { metaPaths: [], thumbRequests: [] };
    }
    const nextMeta: string[] = [];
    const nextThumbs: ThumbnailRequest[] = [];
    for (const item of visibleItems) {
      if (item.type !== "entry") continue;
      if (item.presence === "removed") continue;
      if (item.entry.isDir) continue;
      const path = item.entry.path;
      nextMeta.push(path);
      const meta = entryMeta.get(path);
      // Provide cached size/modified so the backend can hash without extra stats.
      nextThumbs.push({
        path,
        size: meta?.size ?? null,
        modified: meta?.modified ?? null,
      });
    }
    return { metaPaths: nextMeta, thumbRequests: nextThumbs };
  }, [entryMeta, visibleItems]);

  const entryMetaCacheRef = useRef<Map<string, GridDisplayMeta>>(new Map());

  useEffect(() => {
    // Reset cached grid labels on view changes to keep memory bounded.
    entryMetaCacheRef.current.clear();
  }, [viewKey]);

  const gridMetaByPath = useMemo(() => {
    const cache = entryMetaCacheRef.current;
    const next = new Map<string, GridDisplayMeta>();
    visibleItems.forEach((item) => {
      if (item.type !== "entry") return;
      if (item.presence === "removed") return;
      const entry = item.entry;
      const path = entry.path;
      const meta = entryMeta.get(path);
      const cacheKey = `${path}:${meta?.modified ?? "none"}:${meta?.size ?? "none"}`;
      let resolved = cache.get(cacheKey);
      if (!resolved) {
        const extension = entry.isDir ? null : getExtension(entry.name);
        resolved = {
          tooltipText: buildEntryTooltip(entry, meta),
          fileKind: entry.isDir ? "generic" : getFileKind(entry.name),
          extension,
          sizeLabel: entry.isDir ? "Folder" : formatBytes(meta?.size ?? null),
        };
        cache.set(cacheKey, resolved);
      }
      next.set(path, resolved);
    });
    return next;
  }, [entryMeta, visibleItems]);

  useEntryMetaRequest(loading || scrolling, metaPaths, onRequestMeta);
  // Pause thumbnail generation while the user is actively interacting.
  useThumbnailPause(interactionActive, thumbnailsEnabled);
  const canRequestThumbs = thumbnailsEnabled && !loading && !interactionActive;
  const thumbSource = thumbsSuppressed ? thumbSnapshotRef.current : thumbnails;
  const { icons: fileIcons, requestIcons: requestFileIcons } = useFileIcons(thumbnailAppIcons);
  useThumbnailRequest(
    loading || interactionActive,
    canRequestThumbs,
    thumbRequests,
    onRequestThumbs,
    thumbResetKey,
  );

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

  useEffect(() => {
    if (iconRequests.length === 0) return;
    requestFileIcons(iconRequests);
  }, [iconRequests, requestFileIcons]);

  return {
    gridMetaByPath,
    thumbSource,
    fileIcons,
  };
};
