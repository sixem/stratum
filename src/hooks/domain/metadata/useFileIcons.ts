// Fetches and caches default app icons for file extensions.
import { useCallback, useEffect, useRef, useState } from "react";
import { getFileIcons, toFileIconUrl } from "@/api";

const MAX_ICON_BATCH = 80;

const normalizeExtension = (value: string) => {
  return value.trim().replace(/^\.+/, "").toLowerCase();
};

export const useFileIcons = (enabled: boolean) => {
  const [icons, setIcons] = useState<Map<string, string>>(new Map());
  const iconsRef = useRef(icons);
  const pending = useRef(new Set<string>());
  const misses = useRef(new Set<string>());
  const enabledRef = useRef(enabled);

  useEffect(() => {
    iconsRef.current = icons;
  }, [icons]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      pending.current.clear();
      return;
    }
    misses.current.clear();
  }, [enabled]);

  const requestIcons = useCallback(
    async (extensions: string[]) => {
      if (!enabledRef.current) return;
      const deduped: string[] = [];
      const seen = new Set<string>();
      extensions.forEach((extension) => {
        const normalized = normalizeExtension(extension);
        if (!normalized) return;
        if (seen.has(normalized)) return;
        seen.add(normalized);
        if (iconsRef.current.has(normalized)) return;
        if (misses.current.has(normalized)) return;
        if (pending.current.has(normalized)) return;
        deduped.push(normalized);
      });
      if (deduped.length === 0) return;
      const batch = deduped.slice(0, MAX_ICON_BATCH);
      batch.forEach((extension) => pending.current.add(extension));
      const requested = new Set(batch);
      try {
        const hits = await getFileIcons(batch);
        if (!enabledRef.current) return;
        setIcons((prev) => {
          const next = new Map(prev);
          let changed = false;
          hits.forEach((hit) => {
            const normalized = normalizeExtension(hit.extension);
            if (!normalized || next.has(normalized)) return;
            next.set(normalized, toFileIconUrl(hit.iconPath));
            changed = true;
            requested.delete(normalized);
          });
          return changed ? next : prev;
        });
        requested.forEach((extension) => misses.current.add(extension));
      } catch {
        // Ignore icon errors; fallback SVGs remain in place.
      } finally {
        batch.forEach((extension) => pending.current.delete(extension));
      }
    },
    [],
  );

  return { icons, requestIcons };
};
