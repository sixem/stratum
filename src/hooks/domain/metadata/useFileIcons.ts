// Fetches and caches default app icons for file extensions.
import { useCallback, useEffect, useRef, useState } from "react";
import { getFileIcons, toFileIconUrl } from "@/api";

const MAX_ICON_BATCH = 80;
const ICON_CACHE_LIMIT = 512;
const sharedIconCache = new Map<string, string>();

const upsertSharedIcon = (extension: string, iconUrl: string) => {
  if (sharedIconCache.has(extension)) {
    sharedIconCache.delete(extension);
  }
  sharedIconCache.set(extension, iconUrl);
  while (sharedIconCache.size > ICON_CACHE_LIMIT) {
    const oldestKey = sharedIconCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    sharedIconCache.delete(oldestKey);
  }
};

const normalizeExtension = (value: string) => {
  return value.trim().replace(/^\.+/, "").toLowerCase();
};

export const useFileIcons = (enabled: boolean) => {
  const [icons, setIcons] = useState<Map<string, string>>(() => new Map(sharedIconCache));
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
      const hydrateHits = new Map<string, string>();
      const seen = new Set<string>();
      extensions.forEach((extension) => {
        const normalized = normalizeExtension(extension);
        if (!normalized) return;
        if (seen.has(normalized)) return;
        seen.add(normalized);
        const shared = sharedIconCache.get(normalized);
        if (shared && !iconsRef.current.has(normalized)) {
          hydrateHits.set(normalized, shared);
          return;
        }
        if (iconsRef.current.has(normalized)) return;
        if (misses.current.has(normalized)) return;
        if (pending.current.has(normalized)) return;
        deduped.push(normalized);
      });
      if (hydrateHits.size > 0) {
        setIcons((prev) => {
          const next = new Map(prev);
          let changed = false;
          hydrateHits.forEach((url, extension) => {
            if (next.has(extension)) return;
            next.set(extension, url);
            changed = true;
          });
          return changed ? next : prev;
        });
      }
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
            const iconUrl = toFileIconUrl(hit.iconPath);
            next.set(normalized, iconUrl);
            upsertSharedIcon(normalized, iconUrl);
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
