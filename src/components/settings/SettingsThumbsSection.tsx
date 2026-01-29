// Thumbnail generation and preview tuning.
import type { ThumbnailFit } from "@/modules";
import type { SettingsUpdateHandler } from "./types";

type SettingsThumbsSectionProps = {
  sectionId: string;
  thumbnailsEnabled: boolean;
  thumbnailSize: number;
  thumbnailQuality: number;
  thumbnailFormat: "webp" | "jpeg";
  thumbnailVideos: boolean;
  thumbnailFit: ThumbnailFit;
  thumbnailAppIcons: boolean;
  onUpdate: SettingsUpdateHandler;
};

const SIZE_MIN = 96;
const SIZE_MAX = 320;
const SIZE_STEP = 16;
const QUALITY_MIN = 50;
const QUALITY_MAX = 95;
const QUALITY_STEP = 5;

export const SettingsThumbsSection = ({
  sectionId,
  thumbnailsEnabled,
  thumbnailSize,
  thumbnailQuality,
  thumbnailFormat,
  thumbnailVideos,
  thumbnailFit,
  thumbnailAppIcons,
  onUpdate,
}: SettingsThumbsSectionProps) => {
  const isThumbsDisabled = !thumbnailsEnabled;
  const canAdjustQuality = !isThumbsDisabled && thumbnailFormat === "jpeg";
  const qualityLabel = thumbnailFormat === "jpeg" ? `${thumbnailQuality}%` : "Lossless";

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Thumbnails</div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Enable thumbnails</div>
          <div className="settings-desc">Generate preview images in grid view.</div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={thumbnailsEnabled}
            onChange={(event) => onUpdate({ thumbnailsEnabled: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
      <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
        <div>
          <div className="settings-label">Thumbnail size</div>
          <div className="settings-desc">Max edge size for generated previews.</div>
        </div>
        <div className="settings-range">
          <input
            type="range"
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={SIZE_STEP}
            value={thumbnailSize}
            disabled={isThumbsDisabled}
            onChange={(event) => onUpdate({ thumbnailSize: Number(event.currentTarget.value) })}
          />
          <span className="settings-value">{thumbnailSize}px</span>
        </div>
      </div>
      <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
        <div>
          <div className="settings-label">Quality (JPEG)</div>
          <div className="settings-desc">Balance size against visual detail.</div>
        </div>
        <div className="settings-range">
          <input
            type="range"
            min={QUALITY_MIN}
            max={QUALITY_MAX}
            step={QUALITY_STEP}
            value={thumbnailQuality}
            disabled={!canAdjustQuality}
            onChange={(event) =>
              onUpdate({ thumbnailQuality: Number(event.currentTarget.value) })
            }
          />
          <span className="settings-value">{qualityLabel}</span>
        </div>
      </div>
      <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
        <div>
          <div className="settings-label">Video previews</div>
          <div className="settings-desc">
            Attempt thumbnails for local videos when supported.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={thumbnailVideos}
            disabled={isThumbsDisabled}
            onChange={(event) => onUpdate({ thumbnailVideos: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Default app icons</div>
          <div className="settings-desc">
            Show the system icon when no thumbnail is available.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={thumbnailAppIcons}
            onChange={(event) =>
              onUpdate({ thumbnailAppIcons: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </div>
      <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
        <div>
          <div className="settings-label">Thumbnail display</div>
          <div className="settings-desc">
            Cover fills the frame, Fit keeps the entire image visible.
          </div>
        </div>
        <div className="settings-pills" role="group" aria-label="Thumbnail display">
          <button
            type="button"
            disabled={isThumbsDisabled}
            className={`settings-pill${thumbnailFit === "cover" ? " is-active" : ""}`}
            onClick={() => onUpdate({ thumbnailFit: "cover" })}
          >
            Cover
          </button>
          <button
            type="button"
            disabled={isThumbsDisabled}
            className={`settings-pill${thumbnailFit === "contain" ? " is-active" : ""}`}
            onClick={() => onUpdate({ thumbnailFit: "contain" })}
          >
            Fit
          </button>
        </div>
      </div>
    </section>
  );
};
