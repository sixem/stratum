// Prefetches entry metadata over time for non-name sorts.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EntryMeta, FileEntry } from "@/types";

const PREFETCH_INTERVAL_MS = 140;

type MetaPrefetchOptions = {
  enabled: boolean;
  loading: boolean;
  resetKey: string;
  entries: FileEntry[];
  entryMeta: Map<string, EntryMeta>;
  requestMeta: (paths: string[]) => void;
};

export const useMetaPrefetch = ({
  enabled,
  loading,
  resetKey,
  entries,
  entryMeta,
  requestMeta,
}: MetaPrefetchOptions) => {
  const [ready, setReady] = useState(true);
  const metaRef = useRef(entryMeta);

  // Only build the file list when prefetching is active to avoid extra work.
  const filePaths = useMemo(() => {
    if (!enabled) return [];
    return entries.filter((entry) => !entry.isDir).map((entry) => entry.path);
  }, [enabled, entries]);

  useLayoutEffect(() => {
    metaRef.current = entryMeta;
  }, [entryMeta]);

  useLayoutEffect(() => {
    if (!enabled) {
      setReady(true);
      return;
    }
    if (loading) {
      setReady(false);
      return;
    }
    if (filePaths.length === 0) {
      setReady(true);
      return;
    }

    const initialMissing = filePaths.filter((path) => !metaRef.current.has(path));
    if (initialMissing.length === 0) {
      setReady(true);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    setReady(false);

    const tick = () => {
      if (cancelled) return;
      const meta = metaRef.current;
      const missing = filePaths.filter((path) => !meta.has(path));
      if (missing.length === 0) {
        setReady(true);
        return;
      }
      requestMeta(missing);
      timer = window.setTimeout(tick, PREFETCH_INTERVAL_MS);
    };

    requestMeta(initialMissing);
    timer = window.setTimeout(tick, PREFETCH_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [enabled, filePaths, loading, requestMeta, resetKey]);

  return ready;
};
