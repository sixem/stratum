// Thumbnail generation and preview tuning.
import type { ThumbnailFit } from "@/modules";
import { PressButton } from "@/components/primitives/PressButton";
import { useDeferredRange } from "./useDeferredRange";
import type { SettingsUpdateHandler } from "./types";

type SettingsThumbsSectionProps = {
  sectionId: string;
  thumbnailsEnabled: boolean;
  thumbnailSize: number;
  thumbnailQuality: number;
  thumbnailFormat: "webp" | "jpeg";
  thumbnailFolders: boolean;
  thumbnailVideos: boolean;
  thumbnailSvgs: boolean;
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
  thumbnailFolders,
  thumbnailVideos,
  thumbnailSvgs,
  thumbnailFit,
  thumbnailAppIcons,
  onUpdate,
}: SettingsThumbsSectionProps) => {
  const isThumbsDisabled = !thumbnailsEnabled;
  const canAdjustQuality = !isThumbsDisabled && thumbnailFormat === "jpeg";
  const sizeRange = useDeferredRange({
    value: thumbnailSize,
    onCommit: (value) => onUpdate({ thumbnailSize: value }),
  });
  const qualityRange = useDeferredRange({
    value: thumbnailQuality,
    onCommit: (value) => onUpdate({ thumbnailQuality: value }),
  });
  const qualityLabel =
    thumbnailFormat === "jpeg" ? `${qualityRange.draft}%` : "Lossless";

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
            className="ui-range"
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={SIZE_STEP}
            disabled={isThumbsDisabled}
            {...sizeRange.bind}
          />
          <span className="settings-value">{sizeRange.draft}px</span>
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
            className="ui-range"
            min={QUALITY_MIN}
            max={QUALITY_MAX}
            step={QUALITY_STEP}
            disabled={!canAdjustQuality}
            {...qualityRange.bind}
          />
          <span className="settings-value">{qualityLabel}</span>
        </div>
      </div>
      <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
        <div>
          <div className="settings-label">Folder previews</div>
          <div className="settings-desc">
            Generate thumbnails for folders using a sampled file from each folder.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={thumbnailFolders}
            disabled={isThumbsDisabled}
            onChange={(event) => onUpdate({ thumbnailFolders: event.currentTarget.checked })}
          />
          <span />
        </label>
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
      <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
        <div>
          <div className="settings-label">SVG previews</div>
          <div className="settings-desc">
            Rasterize SVGs into safe thumbnails using the same size cap.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={thumbnailSvgs}
            disabled={isThumbsDisabled}
            onChange={(event) => onUpdate({ thumbnailSvgs: event.currentTarget.checked })}
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
          <PressButton
            type="button"
            disabled={isThumbsDisabled}
            className={`settings-pill${thumbnailFit === "cover" ? " is-active" : ""}`}
            onClick={() => onUpdate({ thumbnailFit: "cover" })}
          >
            Cover
          </PressButton>
          <PressButton
            type="button"
            disabled={isThumbsDisabled}
            className={`settings-pill${thumbnailFit === "contain" ? " is-active" : ""}`}
            onClick={() => onUpdate({ thumbnailFit: "contain" })}
          >
            Fit
          </PressButton>
        </div>
      </div>
    </section>
  );
};
