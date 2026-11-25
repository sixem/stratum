// Folder sample thumbnail pipeline for file-grid cards.
//
// Folder cards can borrow a thumbnail from a representative child file. This
// hook owns sample discovery, cache invalidation, and sample thumbnail requests
// so the main grid thumbnail hook only coordinates high-level state.
import { useEffect, useMemo, useRef, useState } from "react";

import { listFolderThumbSamplesBatch } from "@/api";
import { normalizePath } from "@/lib";
import { getDirectoryChildVersion } from "@/modules";
import type { ThumbnailLookup, ThumbnailRequest } from "@/types";

type CachedFolderSample = {
  samplePath: string | null;
  version: number;
};

type UseGridFolderSamplesOptions = {
  viewKey: string;
  folderPaths: string[];
  interactionActive: boolean;
  loading: boolean;
  onRequestThumbs: (requests: ThumbnailRequest[]) => void;
  thumbnailFolders: boolean;
  thumbnailSvgs: boolean;
  thumbnailVideos: boolean;
  thumbnailsEnabled: boolean;
  thumbResetKey?: string;
  thumbSource: ThumbnailLookup;
  directoryChildRevision: number;
};

export type FolderThumbnail = { path: string; url: string };

type GridFolderSamplesState = {
  folderThumbRequestCount: number;
  folderThumbSource: Map<string, FolderThumbnail>;
};

const FOLDER_SAMPLE_CACHE_LIMIT = 3000;

const upsertFolderSample = (
  cache: Map<string, CachedFolderSample>,
  folderKey: string,
  sample: CachedFolderSample,
) => {
  // Refresh insertion order so pruning behaves like a simple LRU.
  if (cache.has(folderKey)) {
    cache.delete(folderKey);
  }
  cache.set(folderKey, sample);
  if (cache.size <= FOLDER_SAMPLE_CACHE_LIMIT) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (!oldestKey) return;
  cache.delete(oldestKey);
};

export const useGridFolderSamples = ({
  viewKey,
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
  directoryChildRevision,
}: UseGridFolderSamplesOptions): GridFolderSamplesState => {
  const [folderSampleByPath, setFolderSampleByPath] = useState<Map<string, CachedFolderSample>>(
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
    // A new visit must re-request any samples whose queued renders were retired.
    requestedFolderSampleThumbsRef.current.clear();
  }, [directoryChildRevision, thumbnailsEnabled, viewKey]);

  useEffect(() => {
    if (!thumbnailsEnabled || !thumbnailFolders || loading || interactionActive) return;
    if (folderPaths.length === 0) return;
    const pendingPaths = folderPaths.filter((folderPath) => {
      const key = normalizePath(folderPath);
      if (!key) return false;
      const cachedSample = folderSampleByPath.get(key) ?? null;
      if (cachedSample && cachedSample.version === getDirectoryChildVersion(folderPath)) {
        return false;
      }
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
            upsertFolderSample(next, folderKey, {
              samplePath: result.samplePath?.trim() || null,
              version: getDirectoryChildVersion(result.folderPath),
            });
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
            upsertFolderSample(next, folderKey, {
              samplePath: null,
              version: getDirectoryChildVersion(folderPath),
            });
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
    directoryChildRevision,
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
    for (const folderPath of folderPaths) {
      const folderKey = normalizePath(folderPath);
      const sample = folderSampleByPath.get(folderKey);
      if (!sample || sample.version !== getDirectoryChildVersion(folderKey)) continue;
      const samplePath = sample.samplePath;
      if (!samplePath) continue;
      // Sample paths are requested verbatim, so direct map lookup avoids
      // rebuilding a normalized index of the full thumbnail cache.
      if (thumbSource.has(samplePath)) continue;
      requests.push({ path: samplePath, size: null, modified: null });
    }
    return requests;
  }, [
    folderPaths,
    folderSampleByPath,
    interactionActive,
    loading,
    thumbnailFolders,
    thumbSource,
    thumbnailsEnabled,
  ]);

  useEffect(() => {
    const requested = requestedFolderSampleThumbsRef.current;
    const missing = folderThumbRequests.filter(({ path }) => {
      if (requested.has(path)) return false;
      requested.add(path);
      return true;
    });
    if (missing.length > 0) onRequestThumbs(missing);
  }, [directoryChildRevision, folderThumbRequests, onRequestThumbs, viewKey]);

  const folderThumbSource = useMemo(() => {
    const next = new Map<string, FolderThumbnail>();
    if (!thumbnailsEnabled || !thumbnailFolders) return next;
    folderPaths.forEach((folderPath) => {
      const folderKey = normalizePath(folderPath);
      if (!folderKey) return;
      const sample = folderSampleByPath.get(folderKey);
      if (!sample) return;
      if (sample.version !== getDirectoryChildVersion(folderPath)) return;
      const samplePath = sample.samplePath;
      if (!samplePath) return;
      const sampleThumb = thumbSource.get(samplePath);
      if (!sampleThumb) return;
      next.set(folderPath, { path: samplePath, url: sampleThumb });
    });
    return next;
  }, [folderPaths, folderSampleByPath, thumbnailFolders, thumbSource, thumbnailsEnabled]);

  return {
    folderThumbRequestCount: folderThumbRequests.length,
    folderThumbSource,
  };
};
