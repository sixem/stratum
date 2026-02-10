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
  buildEntryTooltip,
  formatBytes,
  getExtension,
  getFileKind,
  normalizePath,
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
  thumbnailVideos: boolean;
  thumbnailSvgs: boolean;
  loading: boolean;
};

type GridThumbRequestsState = {
  gridMetaByPath: Map<string, GridDisplayMeta>;
  thumbSource: Map<string, string>;
  folderThumbSource: Map<string, string>;
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
  thumbnailVideos,
  thumbnailSvgs,
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
      // Provide cached size/modified so the backend can hash without extra stats.
      nextThumbs.push({
        path,
        size: meta?.size ?? null,
        modified: meta?.modified ?? null,
      });
    }
    return { metaPaths: nextMeta, thumbRequests: nextThumbs, folderPaths: nextFolders };
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
  }, [thumbResetKey, thumbnailSvgs, thumbnailVideos, viewKey]);

  useEffect(() => {
    if (!thumbnailsEnabled || loading || interactionActive) return;
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
            next.set(folderKey, result.samplePath?.trim() || null);
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
            next.set(folderKey, null);
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
    thumbnailSvgs,
    thumbnailVideos,
    thumbnailsEnabled,
  ]);

  useEffect(() => {
    if (folderSampleByPath.size === 0) return;
    const activeFolders = new Set<string>();
    folderPaths.forEach((folderPath) => {
      const key = normalizePath(folderPath);
      if (!key) return;
      activeFolders.add(key);
    });
    setFolderSampleByPath((previous) => {
      let changed = false;
      const next = new Map<string, string | null>();
      previous.forEach((samplePath, folderKey) => {
        if (!activeFolders.has(folderKey)) {
          changed = true;
          return;
        }
        next.set(folderKey, samplePath);
      });
      return changed ? next : previous;
    });
  }, [folderPaths, folderSampleByPath.size]);

  const normalizedThumbSource = useMemo(() => {
    const next = new Map<string, string>();
    thumbSource.forEach((url, path) => {
      const key = normalizePath(path);
      if (!key) return;
      next.set(key, url);
    });
    return next;
  }, [thumbSource]);

  const folderThumbRequests = useMemo(() => {
    if (!thumbnailsEnabled || loading || interactionActive) return [];
    const requests: ThumbnailRequest[] = [];
    folderSampleByPath.forEach((samplePath) => {
      if (!samplePath) return;
      const sampleKey = normalizePath(samplePath);
      if (!sampleKey) return;
      if (normalizedThumbSource.has(sampleKey)) return;
      if (requestedFolderSampleThumbsRef.current.has(sampleKey)) return;
      requestedFolderSampleThumbsRef.current.add(sampleKey);
      requests.push({ path: samplePath, size: null, modified: null });
    });
    return requests;
  }, [folderSampleByPath, interactionActive, loading, normalizedThumbSource, thumbnailsEnabled]);

  useEffect(() => {
    if (folderThumbRequests.length === 0) return;
    onRequestThumbs(folderThumbRequests);
  }, [folderThumbRequests, onRequestThumbs]);

  const folderThumbSource = useMemo(() => {
    if (!thumbnailsEnabled) return new Map<string, string>();
    const next = new Map<string, string>();
    folderPaths.forEach((folderPath) => {
      const folderKey = normalizePath(folderPath);
      if (!folderKey) return;
      const samplePath = folderSampleByPath.get(folderKey);
      if (!samplePath) return;
      const sampleThumb = normalizedThumbSource.get(normalizePath(samplePath));
      if (!sampleThumb) return;
      next.set(folderPath, sampleThumb);
    });
    return next;
  }, [folderPaths, folderSampleByPath, normalizedThumbSource, thumbSource, thumbnailsEnabled]);

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
    folderThumbSource,
    fileIcons,
  };
};
