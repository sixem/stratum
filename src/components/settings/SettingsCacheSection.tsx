// Cache format and lifecycle controls.
import { useCallback, useEffect, useState } from "react";
import { getThumbCacheSize } from "@/api";
import { formatBytes } from "@/lib";
import { PressButton } from "@/components/primitives/PressButton";
import { useDeferredRange } from "./useDeferredRange";
import type { SettingsUpdateHandler } from "./types";

type SettingsCacheSectionProps = {
  sectionId: string;
  open: boolean;
  thumbnailsEnabled: boolean;
  thumbnailFormat: "webp" | "jpeg";
  thumbnailCacheMb: number;
  onUpdate: SettingsUpdateHandler;
  onOpenCacheLocation?: () => Promise<void>;
  onClearCache?: () => Promise<void>;
};

const CACHE_MIN = 128;
const CACHE_MAX = 4096;
const CACHE_STEP = 128;

export const SettingsCacheSection = ({
  sectionId,
  open,
  thumbnailsEnabled,
  thumbnailFormat,
  thumbnailCacheMb,
  onUpdate,
  onOpenCacheLocation,
  onClearCache,
}: SettingsCacheSectionProps) => {
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheUsageBytes, setCacheUsageBytes] = useState<number | null>(null);
  const isThumbsDisabled = !thumbnailsEnabled;
  const cacheRange = useDeferredRange({
    value: thumbnailCacheMb,
    onCommit: (value) => onUpdate({ thumbnailCacheMb: value }),
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
    if (!open) return;
    refreshCacheUsage();
  }, [open, refreshCacheUsage]);

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
      <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
        <div>
          <div className="settings-label">Image format</div>
          <div className="settings-desc">Pick the saved thumbnail format.</div>
        </div>
        <div className="settings-pills" role="group" aria-label="Thumbnail format">
          <PressButton
            type="button"
            className={`settings-pill${thumbnailFormat === "webp" ? " is-active" : ""}`}
            disabled={isThumbsDisabled}
            onClick={() => onUpdate({ thumbnailFormat: "webp" })}
          >
            WebP
          </PressButton>
          <PressButton
            type="button"
            className={`settings-pill${thumbnailFormat === "jpeg" ? " is-active" : ""}`}
            disabled={isThumbsDisabled}
            onClick={() => onUpdate({ thumbnailFormat: "jpeg" })}
          >
            JPEG
          </PressButton>
        </div>
      </div>
      <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
        <div>
          <div className="settings-label">Cache size limit</div>
          <div className="settings-desc">Approximate max size for disk cache.</div>
        </div>
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
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label settings-label-row">
            <span>Thumbnail cache</span>
            <span className="settings-chip">{cacheUsageLabel}</span>
          </div>
          <div className="settings-desc">Open the cache folder or clear stored previews.</div>
        </div>
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
      </div>
    </section>
  );
};
