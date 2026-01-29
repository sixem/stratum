// Prefetches entry metadata over time for non-name sorts.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EntryMeta, FileEntry } from "@/types";
import { makeDebug } from "@/lib";

const PREFETCH_INTERVAL_MS = 140;
const log = makeDebug("meta");

type MetaPrefetchOptions = {
  enabled: boolean;
  loading: boolean;
  resetKey: string;
  entries: FileEntry[];
  entryMeta: Map<string, EntryMeta>;
  requestMeta: (paths: string[], options?: { defer?: boolean }) => Promise<EntryMeta[]>;
  deferUpdates?: boolean;
  flushMeta?: () => void;
};

export const useMetaPrefetch = ({
  enabled,
  loading,
  resetKey,
  entries,
  entryMeta,
  requestMeta,
  deferUpdates = false,
  flushMeta,
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

    const missingSet = deferUpdates
      ? new Set(filePaths)
      : new Set(filePaths.filter((path) => !metaRef.current.has(path)));
    if (missingSet.size === 0) {
      setReady(true);
      if (deferUpdates && flushMeta) {
        flushMeta();
      }
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    setReady(false);
    if (log.enabled) {
      log(
        "meta prefetch start: %d files, %d missing",
        filePaths.length,
        missingSet.size,
      );
    }

    const applyResults = (batch: string[], results: EntryMeta[]) => {
      const resolved = results.length > 0 ? results.map((meta) => meta.path) : batch;
      resolved.forEach((path) => missingSet.delete(path));
    };

    const scheduleNext = () => {
      if (deferUpdates) {
        tick();
        return;
      }
      timer = window.setTimeout(tick, PREFETCH_INTERVAL_MS);
    };

    const tick = () => {
      if (cancelled) return;
      if (missingSet.size === 0) {
        setReady(true);
        if (log.enabled) {
          log("meta prefetch complete: %d files", filePaths.length);
        }
        if (deferUpdates && flushMeta) {
          flushMeta();
        }
        return;
      }
      const batch = Array.from(missingSet).slice(0, 120);
      void requestMeta(batch, { defer: deferUpdates }).then((results) => {
        if (cancelled) return;
        applyResults(batch, results);
        scheduleNext();
      });
    };

    const firstBatch = Array.from(missingSet).slice(0, 120);
    void requestMeta(firstBatch, { defer: deferUpdates }).then((results) => {
      if (cancelled) return;
      applyResults(firstBatch, results);
      scheduleNext();
    });

    return () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [deferUpdates, enabled, filePaths, flushMeta, loading, requestMeta, resetKey]);

  return ready;
};
