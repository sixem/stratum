// Settings panel for view, flair, and thumbnail options.
import { useCallback, useEffect, useId, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { SettingsCacheSection } from "@/components/settings/SettingsCacheSection";
import { SettingsBarsSection } from "@/components/settings/SettingsBarsSection";
import { SettingsFlairSection } from "@/components/settings/SettingsFlairSection";
import { SettingsGridSection } from "@/components/settings/SettingsGridSection";
import { SettingsKeybindsSection } from "@/components/settings/SettingsKeybindsSection";
import { SettingsSidebarSection } from "@/components/settings/SettingsSidebarSection";
import { SettingsThumbsSection } from "@/components/settings/SettingsThumbsSection";
import { SettingsViewSection } from "@/components/settings/SettingsViewSection";
import { SettingsVitals } from "@/components/settings/SettingsVitals";
import { useSettings } from "@/hooks";

type SettingsOverlayProps = {
  open: boolean;
  onClose: () => void;
  onOpenCacheLocation?: () => Promise<void>;
  onClearCache?: () => Promise<void>;
};

export function SettingsOverlay({
  open,
  onClose,
  onOpenCacheLocation,
  onClearCache,
}: SettingsOverlayProps) {
  const {
    thumbnailsEnabled,
    thumbnailSize,
    thumbnailQuality,
    thumbnailFormat,
    thumbnailVideos,
    thumbnailCacheMb,
    thumbnailFit,
    defaultViewMode,
    showTabNumbers,
    fixedWidthTabs,
    smoothScroll,
    accentTheme,
    categoryTinting,
    showParentEntry,
    ambientBackground,
    blurOverlays,
    keybinds,
    gridSize,
    gridRounded,
    gridCentered,
    gridShowSize,
    gridShowExtension,
    gridNameEllipsis,
    gridNameHideExtension,
    sidebarRecentLimit,
    sidebarShowTips,
    sidebarSectionOrder,
    updateSettings,
  } = useSettings();
  const titleId = useId();
  const viewSectionId = "settings-view";
  const barsSectionId = "settings-bars";
  const gridSectionId = "settings-grid";
  const flairSectionId = "settings-flair";
  const thumbSectionId = "settings-thumbnails";
  const sidebarSectionId = "settings-sidebar";
  const keybindSectionId = "settings-keybinds";
  const cacheSectionId = "settings-cache";
  const [captureActive, setCaptureActive] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (captureActive) return;
      onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [captureActive, onClose, open]);

  useEffect(() => {
    if (open) return;
    setCaptureActive(false);
  }, [open]);

  const handleJump = useCallback(
    (id: string) => (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const target = document.getElementById(id);
      if (!target) return;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    },
    [],
  );

  return (
    <div
      className="settings-overlay"
      data-open={open ? "true" : "false"}
      aria-hidden={open ? "false" : "true"}
      onClick={onClose}
    >
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <div>
            <h2 className="settings-title" id={titleId}>
              Settings
            </h2>
            <p className="settings-subtitle">
              Manage view defaults, flair, thumbnails, and cached previews.
            </p>
          </div>
          <button type="button" className="btn ghost settings-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-sidebar" aria-label="Settings sections">
            <div className="settings-nav">
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(viewSectionId)}
              >
                View
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(barsSectionId)}
              >
                Bars
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(gridSectionId)}
              >
                Grid
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(flairSectionId)}
              >
                Flair
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(sidebarSectionId)}
              >
                Sidebar
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(thumbSectionId)}
              >
                Thumbnails
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(keybindSectionId)}
              >
                Keybinds
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(cacheSectionId)}
              >
                Cache
              </button>
            </div>
            <SettingsVitals open={open} />
          </nav>
          <div className="settings-content">
            <SettingsViewSection
              sectionId={viewSectionId}
              defaultViewMode={defaultViewMode}
              smoothScroll={smoothScroll}
              gridCentered={gridCentered}
              showParentEntry={showParentEntry}
              onUpdate={updateSettings}
            />
            <SettingsBarsSection
              sectionId={barsSectionId}
              showTabNumbers={showTabNumbers}
              fixedWidthTabs={fixedWidthTabs}
              onUpdate={updateSettings}
            />
            <SettingsGridSection
              sectionId={gridSectionId}
              gridSize={gridSize}
              gridRounded={gridRounded}
              gridShowSize={gridShowSize}
              gridShowExtension={gridShowExtension}
              gridNameEllipsis={gridNameEllipsis}
              gridNameHideExtension={gridNameHideExtension}
              onUpdate={updateSettings}
            />
            <SettingsFlairSection
              sectionId={flairSectionId}
              accentTheme={accentTheme}
              categoryTinting={categoryTinting}
              ambientBackground={ambientBackground}
              blurOverlays={blurOverlays}
              onUpdate={updateSettings}
            />
            <SettingsSidebarSection
              sectionId={sidebarSectionId}
              sidebarRecentLimit={sidebarRecentLimit}
              sidebarShowTips={sidebarShowTips}
              sidebarSectionOrder={sidebarSectionOrder}
              onUpdate={updateSettings}
            />
            <SettingsThumbsSection
              sectionId={thumbSectionId}
              thumbnailsEnabled={thumbnailsEnabled}
              thumbnailSize={thumbnailSize}
              thumbnailQuality={thumbnailQuality}
              thumbnailFormat={thumbnailFormat}
              thumbnailVideos={thumbnailVideos}
              thumbnailFit={thumbnailFit}
              onUpdate={updateSettings}
            />
            <SettingsKeybindsSection
              sectionId={keybindSectionId}
              open={open}
              keybinds={keybinds}
              onUpdate={updateSettings}
              onCaptureChange={setCaptureActive}
            />
            <SettingsCacheSection
              sectionId={cacheSectionId}
              open={open}
              thumbnailsEnabled={thumbnailsEnabled}
              thumbnailFormat={thumbnailFormat}
              thumbnailCacheMb={thumbnailCacheMb}
              onUpdate={updateSettings}
              onOpenCacheLocation={onOpenCacheLocation}
              onClearCache={onClearCache}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
