// Folder sample thumbnail pipeline for file-grid cards.
//
// Folder cards can borrow a thumbnail from a representative child file. This
// hook owns sample discovery, cache invalidation, and sample thumbnail requests
// so the main grid thumbnail hook only coordinates high-level state.
import { useEffect, useMemo, useRef, useState } from "react";

import { listFolderThumbSamplesBatch } from "@/api";
import { normalizePath } from "@/lib";
import { getDirectoryChildVersion } from "@/modules";
import type { ThumbnailRequest } from "@/types";

type CachedFolderSample = {
  samplePath: string | null;
  version: number;
};

type UseGridFolderSamplesOptions = {
  folderPaths: string[];
  interactionActive: boolean;
  loading: boolean;
  onRequestThumbs: (requests: ThumbnailRequest[]) => void;
  thumbnailFolders: boolean;
  thumbnailSvgs: boolean;
  thumbnailVideos: boolean;
  thumbnailsEnabled: boolean;
  thumbResetKey?: string;
  thumbSource: Map<string, string>;
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
    // Directory-child revisions mean a folder may now choose a different sample path.
    requestedFolderSampleThumbsRef.current.clear();
  }, [directoryChildRevision]);

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
    folderSampleByPath.forEach((sample, folderKey) => {
      if (sample.version !== getDirectoryChildVersion(folderKey)) return;
      const samplePath = sample.samplePath;
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
