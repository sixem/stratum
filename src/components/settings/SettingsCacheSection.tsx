// Cache format and lifecycle controls.
import { useCallback, useContext, useEffect, useState } from "react";
import { shallow } from "zustand/shallow";
import { getThumbCacheSize } from "@/api";
import { formatBytes } from "@/lib";
import { PressButton } from "@/components/primitives/PressButton";
import { useSettingsStore } from "@/modules";
import { useDeferredRange } from "./useDeferredRange";

import { SettingsItem, SettingsSearchMatches } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const CACHE_SETTINGS_ITEMS = {
  imageFormat: {
    label: "Image format",
    description: "Pick the saved thumbnail format.",
    keywords: "WebP JPEG",
  },
  sizeLimit: {
    label: "Cache size limit",
    description: "Approximate max size for disk cache.",
  },
  thumbnailCache: {
    label: "Thumbnail cache",
    description: "Open the cache folder or clear stored previews.",
    keywords: "open clear",
  },
} satisfies Record<string, SettingsItemText>;

type SettingsCacheSectionProps = {
  sectionId: string;
  open: boolean;
  onOpenCacheLocation?: () => Promise<void>;
  onClearCache?: () => Promise<void>;
};

const CACHE_MIN = 128;
const CACHE_MAX = 4096;
const CACHE_STEP = 128;

export const SettingsCacheSection = ({
  sectionId,
  open,
  onOpenCacheLocation,
  onClearCache,
}: SettingsCacheSectionProps) => {
  const { thumbnailsEnabled, thumbnailFormat, thumbnailCacheMb, updateSettings } =
    useSettingsStore(
      (state) => ({
        thumbnailsEnabled: state.thumbnailsEnabled,
        thumbnailFormat: state.thumbnailFormat,
        thumbnailCacheMb: state.thumbnailCacheMb,
        updateSettings: state.updateSettings,
      }),
      shallow,
    );
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheUsageBytes, setCacheUsageBytes] = useState<number | null>(null);
  const matches = useContext(SettingsSearchMatches);
  const searching = matches !== null;
  const showCacheUsage = !matches || matches.has(CACHE_SETTINGS_ITEMS.thumbnailCache);
  const isThumbsDisabled = !thumbnailsEnabled;
  const cacheRange = useDeferredRange({
    value: thumbnailCacheMb,
    onCommit: (value) => updateSettings({ thumbnailCacheMb: value }),
  });

  const refreshCacheUsage = useCallback(async () => {
    try {
      const nextSize = await getThumbCacheSize();
      setCacheUsageBytes(Number.isFinite(nextSize) ? nextSize : null);
    } catch {
      setCacheUsageBytes(null);
    }
  }, []);

  useEffect(() => {
    if (!open || !showCacheUsage) return;
    if (!searching) {
      void refreshCacheUsage();
      return;
    }
    // A row can briefly match while typing. Wait before walking the disk cache.
    const timer = window.setTimeout(() => { void refreshCacheUsage(); }, 200);
    return () => window.clearTimeout(timer);
  }, [open, refreshCacheUsage, searching, showCacheUsage]);

  const handleOpenCache = async () => {
    if (!open || cacheBusy || !onOpenCacheLocation) return;
    setCacheBusy(true);
    try {
      await onOpenCacheLocation();
    } finally {
      setCacheBusy(false);
    }
  };

  const handleClearCache = async () => {
    if (!open || cacheBusy || !onClearCache) return;
    setCacheBusy(true);
    try {
      await onClearCache();
      await refreshCacheUsage();
    } finally {
      setCacheBusy(false);
    }
  };

  const cacheUsageLabel = `Used: ${formatBytes(cacheUsageBytes)}`;

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Cache</div>
      <SettingsItem
        item={CACHE_SETTINGS_ITEMS.imageFormat}
        className={isThumbsDisabled ? "is-disabled" : undefined}
      >
        <div className="settings-pills" role="group" aria-label="Thumbnail format">
          <PressButton
            type="button"
            className={`settings-pill${thumbnailFormat === "webp" ? " is-active" : ""}`}
            disabled={isThumbsDisabled}
            onClick={() => updateSettings({ thumbnailFormat: "webp" })}
          >
            WebP
          </PressButton>
          <PressButton
            type="button"
            className={`settings-pill${thumbnailFormat === "jpeg" ? " is-active" : ""}`}
            disabled={isThumbsDisabled}
            onClick={() => updateSettings({ thumbnailFormat: "jpeg" })}
          >
            JPEG
          </PressButton>
        </div>
      </SettingsItem>
      <SettingsItem
        item={CACHE_SETTINGS_ITEMS.sizeLimit}
        className={isThumbsDisabled ? "is-disabled" : undefined}
      >
        <div className="settings-range">
          <input
            type="range"
            className="ui-range"
            min={CACHE_MIN}
            max={CACHE_MAX}
            step={CACHE_STEP}
            disabled={isThumbsDisabled}
            {...cacheRange.bind}
          />
          <span className="settings-value">{cacheRange.draft} MB</span>
        </div>
      </SettingsItem>
      <SettingsItem
        item={CACHE_SETTINGS_ITEMS.thumbnailCache}
        labelDetail={<span className="settings-chip tnum">{cacheUsageLabel}</span>}
      >
        <div className="settings-actions">
          <PressButton
            type="button"
            className="btn ghost"
            disabled={cacheBusy || !onOpenCacheLocation}
            onClick={handleOpenCache}
          >
            Open
          </PressButton>
          <PressButton
            type="button"
            className="btn"
            disabled={cacheBusy || !onClearCache}
            onClick={handleClearCache}
          >
            Clear
          </PressButton>
        </div>
      </SettingsItem>
    </section>
  );
};
