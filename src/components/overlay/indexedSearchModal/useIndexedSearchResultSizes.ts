// Batch size lookups for the result window after scrolling settles.
import { useEffect, useMemo, useRef, useState } from "react";
import { statEntries } from "@/api/fs";
import type { IndexedPathMatch } from "@/types";

const SIZE_CACHE_LIMIT = 512;
const SIZE_REQUEST_DELAY_MS = 90;

export const useIndexedSearchResultSizes = (visible: boolean, results: IndexedPathMatch[]) => {
  const [sizes, setSizes] = useState(() => new Map<string, number | null>());
  const runningRef = useRef(false);
  const paths = useMemo(() => results.filter(({ kind }) => kind === "file").map(({ path }) => path), [results]);

  useEffect(() => {
    if (!visible || runningRef.current) return;
    const missing = paths.filter((path) => !sizes.has(path));
    if (missing.length === 0) return;

    const timer = window.setTimeout(async () => {
      runningRef.current = true;
      // Missing or inaccessible files still keep their search rows.
      const entries = await statEntries(missing).catch(() => []);
      runningRef.current = false;
      const byPath = new Map(entries.map(({ path, size }) => [path, size]));
      setSizes((current) => {
        const next = new Map(current);
        for (const path of missing) next.set(path, byPath.get(path) ?? null);
        const oldest = next.keys();
        while (next.size > SIZE_CACHE_LIMIT) {
          const path = oldest.next().value;
          if (path === undefined) break;
          next.delete(path);
        }
        return next;
      });
    }, SIZE_REQUEST_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [paths, sizes, visible]);

  return sizes;
};
