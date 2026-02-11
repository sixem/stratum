// Settings panel for view, flair, and thumbnail options.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { SettingsCacheSection } from "@/components/settings/SettingsCacheSection";
import { SettingsBarsSection } from "@/components/settings/SettingsBarsSection";
import { SettingsFlairSection } from "@/components/settings/SettingsFlairSection";
import { SettingsGeneralSection } from "@/components/settings/SettingsGeneralSection";
import { SettingsGridSection } from "@/components/settings/SettingsGridSection";
import { SettingsKeybindsSection } from "@/components/settings/SettingsKeybindsSection";
import { SettingsMenusSection } from "@/components/settings/SettingsMenusSection";
import { SettingsThumbsSection } from "@/components/settings/SettingsThumbsSection";
import { SettingsVitals } from "@/components/settings/SettingsVitals";
import { PressButton } from "@/components/primitives/PressButton";
import { useModalFocusTrap, useSettings } from "@/hooks";
import { usePromptStore } from "@/modules";

type SettingsOverlayProps = {
  open: boolean;
  onClose: () => void;
  onOpenCacheLocation?: () => Promise<void>;
  onClearCache?: () => Promise<void>;
};

export const SettingsOverlay = ({
  open,
  onClose,
  onOpenCacheLocation,
  onClearCache,
}: SettingsOverlayProps) => {
  const {
    thumbnailsEnabled,
    thumbnailSize,
    thumbnailQuality,
    thumbnailFormat,
    thumbnailVideos,
    thumbnailSvgs,
    thumbnailCacheMb,
    thumbnailFit,
    thumbnailAppIcons,
    defaultViewMode,
    showTabNumbers,
    fixedWidthTabs,
    smoothScroll,
    smartTabJump,
    compactMode,
    accentTheme,
    categoryTinting,
    showParentEntry,
    confirmDelete,
    confirmClose,
    ambientBackground,
    blurOverlays,
    keybinds,
    gridSize,
    gridAutoColumns,
    gridGap,
    gridRounded,
    gridCentered,
    gridShowSize,
    gridShowExtension,
    gridNameEllipsis,
    gridNameHideExtension,
    menuOpenPwsh,
    menuOpenWsl,
    sidebarRecentLimit,
    sidebarSectionOrder,
    sidebarHiddenSections,
    updateSettings,
    resetSettings,
  } = useSettings();
  const titleId = useId();
  const generalSectionId = "settings-general";
  const barsSectionId = "settings-bars";
  const gridSectionId = "settings-grid";
  const menuSectionId = "settings-menus";
  const flairSectionId = "settings-flair";
  const thumbSectionId = "settings-thumbnails";
  const keybindSectionId = "settings-keybinds";
  const cacheSectionId = "settings-cache";
  const [captureActive, setCaptureActive] = useState(false);
  const shouldCloseRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useModalFocusTrap({
    open,
    containerRef: panelRef,
    initialFocusRef: closeButtonRef,
  });

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

  const handleResetSettings = useCallback(() => {
    // Confirm reset to avoid wiping custom settings by accident.
    usePromptStore.getState().showPrompt({
      title: "Reset all settings?",
      content: "This will restore every setting to the default values.",
      confirmLabel: "Reset",
      cancelLabel: "Cancel",
      onConfirm: () => {
        resetSettings();
      },
    });
  }, [resetSettings]);

  return (
    <div
      className="settings-overlay"
      data-open={open ? "true" : "false"}
      aria-hidden={open ? "false" : "true"}
      onMouseDown={(event) => {
        shouldCloseRef.current = event.target === event.currentTarget;
      }}
      onClick={() => {
        if (shouldCloseRef.current) {
          onClose();
        }
        shouldCloseRef.current = false;
      }}
    >
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
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
          <PressButton
            ref={closeButtonRef}
            type="button"
            className="btn ghost settings-close"
            onClick={onClose}
          >
            Close
          </PressButton>
        </div>
        <div className="settings-body">
          <nav className="settings-sidebar" aria-label="Settings sections">
            <div className="settings-nav">
              <PressButton
                type="button"
                className="settings-nav-item"
                onClick={handleJump(generalSectionId)}
              >
                General
              </PressButton>
              <PressButton
                type="button"
                className="settings-nav-item"
                onClick={handleJump(barsSectionId)}
              >
                Bars
              </PressButton>
              <PressButton
                type="button"
                className="settings-nav-item"
                onClick={handleJump(gridSectionId)}
              >
                Grid
              </PressButton>
              <PressButton
                type="button"
                className="settings-nav-item"
                onClick={handleJump(menuSectionId)}
              >
                Menus
              </PressButton>
              <PressButton
                type="button"
                className="settings-nav-item"
                onClick={handleJump(flairSectionId)}
              >
                Flair
              </PressButton>
              <PressButton
                type="button"
                className="settings-nav-item"
                onClick={handleJump(thumbSectionId)}
              >
                Thumbnails
              </PressButton>
              <PressButton
                type="button"
                className="settings-nav-item"
                onClick={handleJump(keybindSectionId)}
              >
                Keybinds
              </PressButton>
              <PressButton
                type="button"
                className="settings-nav-item"
                onClick={handleJump(cacheSectionId)}
              >
                Cache
              </PressButton>
            </div>
            <div className="settings-sidebar-actions">
              <div className="settings-sidebar-title">Actions</div>
              <PressButton
                type="button"
                className="btn settings-reset"
                onClick={handleResetSettings}
              >
                Reset all to defaults
              </PressButton>
              <div className="settings-desc">
                Resets every setting and keybind back to default.
              </div>
            </div>
            <SettingsVitals open={open} />
          </nav>
          <div className="settings-content">
            <SettingsGeneralSection
              sectionId={generalSectionId}
              defaultViewMode={defaultViewMode}
              smoothScroll={smoothScroll}
              gridCentered={gridCentered}
              compactMode={compactMode}
              showParentEntry={showParentEntry}
              confirmDelete={confirmDelete}
              confirmClose={confirmClose}
              onUpdate={updateSettings}
            />
            <SettingsBarsSection
              sectionId={barsSectionId}
              showTabNumbers={showTabNumbers}
              fixedWidthTabs={fixedWidthTabs}
              sidebarRecentLimit={sidebarRecentLimit}
              sidebarSectionOrder={sidebarSectionOrder}
              sidebarHiddenSections={sidebarHiddenSections}
              onUpdate={updateSettings}
            />
            <SettingsGridSection
              sectionId={gridSectionId}
              gridSize={gridSize}
              gridAutoColumns={gridAutoColumns}
              gridGap={gridGap}
              gridRounded={gridRounded}
              gridShowSize={gridShowSize}
              gridShowExtension={gridShowExtension}
              gridNameEllipsis={gridNameEllipsis}
              gridNameHideExtension={gridNameHideExtension}
              onUpdate={updateSettings}
            />
            <SettingsMenusSection
              sectionId={menuSectionId}
              menuOpenPwsh={menuOpenPwsh}
              menuOpenWsl={menuOpenWsl}
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
            <SettingsThumbsSection
              sectionId={thumbSectionId}
              thumbnailsEnabled={thumbnailsEnabled}
              thumbnailSize={thumbnailSize}
              thumbnailQuality={thumbnailQuality}
              thumbnailFormat={thumbnailFormat}
              thumbnailVideos={thumbnailVideos}
              thumbnailSvgs={thumbnailSvgs}
              thumbnailFit={thumbnailFit}
              thumbnailAppIcons={thumbnailAppIcons}
              onUpdate={updateSettings}
            />
            <SettingsKeybindsSection
              sectionId={keybindSectionId}
              open={open}
              keybinds={keybinds}
              smartTabJump={smartTabJump}
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
};
