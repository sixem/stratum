// Fill gaps in a metadata-sorted directory listing after the view has painted.
import { useEffect, useRef } from "react";
import type { EntryMeta, FileEntry } from "@/types";
import { nextMetadataBatch } from "./metadataBatch";

const PREFETCH_BATCH_SIZE = 120;
const PREFETCH_INTERVAL_MS = 140;

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
  const metaRef = useRef(entryMeta);
  useEffect(() => {
    metaRef.current = entryMeta;
  }, [entryMeta]);

  useEffect(() => {
    if (!enabled || loading) return;
    let cancelled = false;
    let cursor = 0;
    let timer: number;
    const tick = async () => {
      const batch = nextMetadataBatch(entries, cursor, metaRef.current, PREFETCH_BATCH_SIZE);
      cursor = batch.cursor;
      if (batch.paths.length) await requestMeta(batch.paths, { defer: deferUpdates });
      if (cancelled) return;
      if (cursor < entries.length) {
        // Even a fully cached IPC batch can resolve immediately. Yield to input
        // before continuing through the rest of a large directory.
        timer = window.setTimeout(tick, PREFETCH_INTERVAL_MS);
      } else if (deferUpdates) {
        flushMeta?.();
      }
    };
    timer = window.setTimeout(tick, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deferUpdates, enabled, entries, flushMeta, loading, requestMeta, resetKey]);
};
