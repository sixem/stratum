// Thumbnail generation and preview tuning.
import { shallow } from "zustand/shallow";
import { PressButton } from "@/components/primitives/PressButton";
import { useSettingsStore } from "@/modules";
import { useDeferredRange } from "./useDeferredRange";

import { SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const THUMBS_SETTINGS_ITEMS = {
  enable: {
    label: "Enable thumbnails",
    description: "Generate preview images in grid view.",
  },
  size: {
    label: "Thumbnail size",
    description: "Max edge size for generated previews.",
  },
  imageFormat: {
    label: "Thumbnail format",
    description: "Choose the image format used to store thumbnails.",
    keywords: "image format WebP JPEG cache",
  },
  quality: {
    label: "Quality (JPEG)",
    description: "Balance size against visual detail.",
  },
  folderPreviews: {
    label: "Folder previews",
    description: "Generate thumbnails for folders using a sampled file from each folder.",
  },
  videoPreviews: {
    label: "Video previews",
    description: "Attempt thumbnails for local videos when supported.",
  },
  svgPreviews: {
    label: "SVG previews",
    description: "Rasterize SVGs into safe thumbnails using the same size cap.",
  },
  appIcons: {
    label: "Default app icons",
    description: "Show Windows icons when no thumbnail is available, including icons embedded in executables.",
  },
  display: {
    label: "Thumbnail display",
    description: "Cover fills the frame, Fit keeps the entire image visible.",
  },
} satisfies Record<string, SettingsItemText>;

type SettingsThumbsSectionProps = {
  sectionId: string;
};

const SIZE_MIN = 96;
const SIZE_MAX = 320;
const SIZE_STEP = 16;
const QUALITY_MIN = 50;
const QUALITY_MAX = 95;
const QUALITY_STEP = 5;

export const SettingsThumbsSection = ({ sectionId }: SettingsThumbsSectionProps) => {
  const {
    thumbnailsEnabled,
    thumbnailSize,
    thumbnailQuality,
    thumbnailFormat,
    thumbnailFolders,
    thumbnailVideos,
    thumbnailSvgs,
    thumbnailFit,
    thumbnailAppIcons,
    updateSettings,
  } = useSettingsStore(
    (state) => ({
      thumbnailsEnabled: state.thumbnailsEnabled,
      thumbnailSize: state.thumbnailSize,
      thumbnailQuality: state.thumbnailQuality,
      thumbnailFormat: state.thumbnailFormat,
      thumbnailFolders: state.thumbnailFolders,
      thumbnailVideos: state.thumbnailVideos,
      thumbnailSvgs: state.thumbnailSvgs,
      thumbnailFit: state.thumbnailFit,
      thumbnailAppIcons: state.thumbnailAppIcons,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const isThumbsDisabled = !thumbnailsEnabled;
  const canAdjustQuality = !isThumbsDisabled && thumbnailFormat === "jpeg";
  const sizeRange = useDeferredRange({
    value: thumbnailSize,
    onCommit: (value) => updateSettings({ thumbnailSize: value }),
  });
  const qualityRange = useDeferredRange({
    value: thumbnailQuality,
    onCommit: (value) => updateSettings({ thumbnailQuality: value }),
  });
  const qualityLabel =
    thumbnailFormat === "jpeg" ? `${qualityRange.draft}%` : "Lossless";

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Thumbnails</div>
      <SettingsItem item={THUMBS_SETTINGS_ITEMS.enable}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={thumbnailsEnabled}
            onChange={(event) =>
              updateSettings({ thumbnailsEnabled: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={THUMBS_SETTINGS_ITEMS.size} className={isThumbsDisabled ? "is-disabled" : undefined}>
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
      </SettingsItem>
      <SettingsItem
        item={THUMBS_SETTINGS_ITEMS.imageFormat}
        className={isThumbsDisabled ? "is-disabled" : undefined}
      >
        <div className="settings-pills" role="group" aria-label={THUMBS_SETTINGS_ITEMS.imageFormat.label}>
          {(["webp", "jpeg"] as const).map((format) => (
            <PressButton
              key={format}
              type="button"
              aria-pressed={thumbnailFormat === format}
              className={`settings-pill${thumbnailFormat === format ? " is-active" : ""}`}
              disabled={isThumbsDisabled}
              onClick={() => updateSettings({ thumbnailFormat: format })}
            >
              {format === "webp" ? "WebP" : "JPEG"}
            </PressButton>
          ))}
        </div>
      </SettingsItem>
      <SettingsItem
        item={THUMBS_SETTINGS_ITEMS.quality}
        className={isThumbsDisabled ? "is-disabled" : undefined}
      >
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
      </SettingsItem>
      <SettingsItem
        item={THUMBS_SETTINGS_ITEMS.folderPreviews}
        className={isThumbsDisabled ? "is-disabled" : undefined}
      >
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={thumbnailFolders}
            disabled={isThumbsDisabled}
            onChange={(event) =>
              updateSettings({ thumbnailFolders: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem
        item={THUMBS_SETTINGS_ITEMS.videoPreviews}
        className={isThumbsDisabled ? "is-disabled" : undefined}
      >
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={thumbnailVideos}
            disabled={isThumbsDisabled}
            onChange={(event) =>
              updateSettings({ thumbnailVideos: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem
        item={THUMBS_SETTINGS_ITEMS.svgPreviews}
        className={isThumbsDisabled ? "is-disabled" : undefined}
      >
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={thumbnailSvgs}
            disabled={isThumbsDisabled}
            onChange={(event) =>
              updateSettings({ thumbnailSvgs: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={THUMBS_SETTINGS_ITEMS.appIcons}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={thumbnailAppIcons}
            onChange={(event) =>
              updateSettings({ thumbnailAppIcons: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem
        item={THUMBS_SETTINGS_ITEMS.display}
        className={isThumbsDisabled ? "is-disabled" : undefined}
      >
        <div className="settings-pills" role="group" aria-label="Thumbnail display">
          <PressButton
            type="button"
            disabled={isThumbsDisabled}
            className={`settings-pill${thumbnailFit === "cover" ? " is-active" : ""}`}
            onClick={() => updateSettings({ thumbnailFit: "cover" })}
          >
            Cover
          </PressButton>
          <PressButton
            type="button"
            disabled={isThumbsDisabled}
            className={`settings-pill${thumbnailFit === "contain" ? " is-active" : ""}`}
            onClick={() => updateSettings({ thumbnailFit: "contain" })}
          >
            Fit
          </PressButton>
        </div>
      </SettingsItem>
    </section>
  );
};
