// Metadata + thumbnail request pipeline for the file grid.
import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { listFolderThumbSamplesBatch } from "@/api";
import {
  useEntryMetaRequest,
  useFileIcons,
  useScrollSettled,
  useThumbnailPause,
  useThumbnailRequest,
  useTypingActivity,
} from "@/hooks";
import {
  formatBytes,
  getExtension,
  getFileKind,
  makeDebug,
  normalizePath,
} from "@/lib";
import type { FileKind } from "@/lib";
import type { EntryItem } from "@/lib";
import { THUMB_INTERACTION_COOLDOWN_MS, THUMB_TYPING_PAUSE_MS } from "@/constants";
import type { EntryMeta, ThumbnailRequest } from "@/types";

export type GridDisplayMeta = {
  fileKind: FileKind;
  extension: string | null;
  sizeLabel: string;
};

type CachedGridDisplayMeta = GridDisplayMeta & {
  signature: string;
};

type UseGridThumbRequestsOptions = {
  viewportRef: RefObject<HTMLDivElement | null>;
  viewKey: string;
  visibleItems: EntryItem[];
  isResizing: boolean;
  entryMeta: Map<string, EntryMeta>;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  thumbnailsEnabled: boolean;
  thumbnails: Map<string, string>;
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
  thumbSource: Map<string, string>;
  folderThumbSource: Map<string, string>;
  fileIcons: Map<string, string>;
  scrolling: boolean;
  interactionActive: boolean;
};

const FOLDER_SAMPLE_CACHE_LIMIT = 3000;
const GRID_META_CACHE_LIMIT = 5000;
const perf = makeDebug("perf:resize:enrich");

const upsertFolderSample = (
  cache: Map<string, string | null>,
  folderKey: string,
  samplePath: string | null,
) => {
  // Refresh insertion order so pruning behaves like a simple LRU.
  if (cache.has(folderKey)) {
    cache.delete(folderKey);
  }
  cache.set(folderKey, samplePath);
  if (cache.size <= FOLDER_SAMPLE_CACHE_LIMIT) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (!oldestKey) return;
  cache.delete(oldestKey);
};

const upsertGridMetaCache = (
  cache: Map<string, CachedGridDisplayMeta>,
  key: string,
  value: CachedGridDisplayMeta,
) => {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > GRID_META_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

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
  const scrolling = useScrollSettled(viewportRef);
  const typingActive = useTypingActivity({ resetDelayMs: THUMB_TYPING_PAUSE_MS });
  // Treat resize like scroll/typing so enrichment yields while layout is hot.
  const interactionActive = scrolling || typingActive || isResizing;
  const [thumbsSuppressed, setThumbsSuppressed] = useState(false);
  const thumbSnapshotRef = useRef<Map<string, string>>(new Map());
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

  const { metaPaths, thumbRequests, folderPaths } = useMemo(() => {
    // Build the meta + thumbnail request lists in one pass to keep allocations low.
    if (visibleItems.length === 0) {
      return { metaPaths: [], thumbRequests: [], folderPaths: [] };
    }
    const nextMeta: string[] = [];
    const nextThumbs: ThumbnailRequest[] = [];
    const nextFolders: string[] = [];
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
    }
    return { metaPaths: nextMeta, thumbRequests: nextThumbs, folderPaths: nextFolders };
  }, [entryMeta, visibleItems]);

  const entryMetaCacheRef = useRef<Map<string, CachedGridDisplayMeta>>(new Map());

  const gridMetaByPath = useMemo(() => {
    const cache = entryMetaCacheRef.current;
    const next = new Map<string, GridDisplayMeta>();
    visibleItems.forEach((item) => {
      if (item.type !== "entry") return;
      if (item.presence === "removed") return;
      const entry = item.entry;
      const path = entry.path;
      const meta = entryMeta.get(path);
      const resolvedMeta: EntryMeta | undefined =
        meta ??
        (entry.size != null || entry.modified != null
          ? {
              path,
              size: entry.size ?? null,
              modified: entry.modified ?? null,
            }
          : undefined);
      const resolvedSize = resolvedMeta?.size ?? null;
      const resolvedModified = resolvedMeta?.modified ?? null;
      const cacheKey = `${viewKey}:${path}`;
      const signature = `${resolvedModified ?? "none"}:${resolvedSize ?? "none"}`;
      const cached = cache.get(cacheKey);
      const canReuseCached =
        cached != null && (signature === "none:none" || cached.signature === signature);
      if (canReuseCached) {
        next.set(path, cached);
        return;
      }
      let resolved = cached;
      if (!resolved || resolved.signature !== signature) {
        const extension = entry.isDir ? null : getExtension(entry.name);
        resolved = {
          fileKind: entry.isDir ? "generic" : getFileKind(entry.name),
          extension,
          sizeLabel: entry.isDir ? "Folder" : formatBytes(resolvedSize),
          signature,
        };
        upsertGridMetaCache(cache, cacheKey, resolved);
      }
      next.set(path, resolved);
    });
    return next;
  }, [entryMeta, viewKey, visibleItems]);

  useEntryMetaRequest(loading || interactionActive, metaPaths, onRequestMeta);
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

  const [folderSampleByPath, setFolderSampleByPath] = useState<Map<string, string | null>>(
    new Map(),
  );
  const pendingFolderFetchesRef = useRef<Set<string>>(new Set());
  const folderSampleGenerationRef = useRef(0);
  const requestedFolderSampleThumbsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    folderSampleGenerationRef.current += 1;
    pendingFolderFetchesRef.current.clear();
    requestedFolderSampleThumbsRef.current.clear();
    setFolderSampleByPath(new Map());
  }, [thumbResetKey, thumbnailFolders, thumbnailSvgs, thumbnailVideos]);

  useEffect(() => {
    if (!thumbnailsEnabled || !thumbnailFolders || loading || interactionActive) return;
    if (folderPaths.length === 0) return;
    const pendingPaths = folderPaths.filter((folderPath) => {
      const key = normalizePath(folderPath);
      if (!key) return false;
      if (folderSampleByPath.has(key)) return false;
      if (pendingFolderFetchesRef.current.has(key)) return false;
      return true;
    });
    if (pendingPaths.length === 0) return;
    const requestGeneration = folderSampleGenerationRef.current;
    pendingPaths.forEach((path) => pendingFolderFetchesRef.current.add(normalizePath(path)));
    void listFolderThumbSamplesBatch(pendingPaths, {
      allowVideos: thumbnailVideos,
      allowSvgs: thumbnailSvgs,
    })
      .then((results) => {
        if (requestGeneration !== folderSampleGenerationRef.current) return;
        setFolderSampleByPath((previous) => {
          const next = new Map(previous);
          results.forEach((result) => {
            const folderKey = normalizePath(result.folderPath);
            if (!folderKey) return;
            upsertFolderSample(next, folderKey, result.samplePath?.trim() || null);
          });
          return next;
        });
      })
      .catch(() => {
        if (requestGeneration !== folderSampleGenerationRef.current) return;
        setFolderSampleByPath((previous) => {
          const next = new Map(previous);
          pendingPaths.forEach((folderPath) => {
            const folderKey = normalizePath(folderPath);
            if (!folderKey) return;
            upsertFolderSample(next, folderKey, null);
          });
          return next;
        });
      })
      .finally(() => {
        pendingPaths.forEach((folderPath) =>
          pendingFolderFetchesRef.current.delete(normalizePath(folderPath)),
        );
      });
  }, [
    folderPaths,
    folderSampleByPath,
    interactionActive,
    loading,
    thumbnailFolders,
    thumbnailSvgs,
    thumbnailVideos,
    thumbnailsEnabled,
  ]);

  const folderThumbRequests = useMemo(() => {
    if (!thumbnailsEnabled || !thumbnailFolders || loading || interactionActive) return [];
    const requests: ThumbnailRequest[] = [];
    folderSampleByPath.forEach((samplePath) => {
      if (!samplePath) return;
      // Sample paths are requested verbatim, so direct map lookup avoids
      // rebuilding a normalized index of the full thumbnail cache.
      if (thumbSource.has(samplePath)) return;
      if (requestedFolderSampleThumbsRef.current.has(samplePath)) return;
      requestedFolderSampleThumbsRef.current.add(samplePath);
      requests.push({ path: samplePath, size: null, modified: null });
    });
    return requests;
  }, [
    folderSampleByPath,
    interactionActive,
    loading,
    thumbnailFolders,
    thumbSource,
    thumbnailsEnabled,
  ]);

  useEffect(() => {
    if (folderThumbRequests.length === 0) return;
    onRequestThumbs(folderThumbRequests);
  }, [folderThumbRequests, onRequestThumbs]);

  const folderThumbSource = useMemo(() => {
    if (!thumbnailsEnabled || !thumbnailFolders) return new Map<string, string>();
    const next = new Map<string, string>();
    folderPaths.forEach((folderPath) => {
      const folderKey = normalizePath(folderPath);
      if (!folderKey) return;
      const samplePath = folderSampleByPath.get(folderKey);
      if (!samplePath) return;
      const sampleThumb = thumbSource.get(samplePath);
      if (!sampleThumb) return;
      next.set(folderPath, sampleThumb);
    });
    return next;
  }, [folderPaths, folderSampleByPath, thumbnailFolders, thumbSource, thumbnailsEnabled]);

  const iconRequests = useMemo(() => {
    if (!thumbnailAppIcons || loading || interactionActive || visibleItems.length === 0) {
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
  }, [interactionActive, loading, thumbnailAppIcons, visibleItems]);

  useEffect(() => {
    if (iconRequests.length === 0) return;
    requestFileIcons(iconRequests);
  }, [iconRequests, requestFileIcons]);

  useEffect(() => {
    if (!perf.enabled) return;
    const snapshot = [
      viewKey,
      visibleItems.length,
      metaPaths.length,
      thumbRequests.length,
      folderPaths.length,
      folderThumbRequests.length,
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
      folderThumbRequests.length,
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
    folderThumbRequests.length,
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
    scrolling,
    interactionActive,
  };
};
