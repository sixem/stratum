// Settings panel for view, flair, and thumbnail options.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { SettingsVitals } from "@/components/settings/SettingsVitals";
import {
  DEFAULT_SETTINGS_SECTION_ID,
  SETTINGS_SECTION_DEFINITIONS,
  type SettingsSectionId,
} from "@/components/settings/settingsSectionRegistry";
import { PressButton } from "@/components/primitives/PressButton";
import { useModalFocusTrap } from "@/hooks";
import { usePromptStore, useSettingsStore } from "@/modules";

export type SettingsOverlayProps = {
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
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const titleId = useId();
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(
    DEFAULT_SETTINGS_SECTION_ID,
  );
  const [captureActive, setCaptureActive] = useState(false);
  const shouldCloseRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeSection =
    useMemo(
      () =>
        SETTINGS_SECTION_DEFINITIONS.find((section) => section.id === activeSectionId) ??
        SETTINGS_SECTION_DEFINITIONS[0],
      [activeSectionId],
    );

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

  const handleSelectSection = useCallback((id: SettingsSectionId) => {
    setActiveSectionId(id);
    setCaptureActive(false);
  }, []);

  const handleSectionKeyDown = useCallback(
    (index: number) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const lastIndex = SETTINGS_SECTION_DEFINITIONS.length - 1;
      let nextIndex: number | null = null;
      switch (event.key) {
        case "ArrowDown":
        case "ArrowRight":
          nextIndex = index >= lastIndex ? 0 : index + 1;
          break;
        case "ArrowUp":
        case "ArrowLeft":
          nextIndex = index <= 0 ? lastIndex : index - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = lastIndex;
          break;
        default:
          return;
      }
      event.preventDefault();
      const nextSection = SETTINGS_SECTION_DEFINITIONS[nextIndex];
      handleSelectSection(nextSection.id);
      tabRefs.current[nextIndex]?.focus();
    },
    [handleSelectSection],
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
            <div className="settings-nav" role="tablist">
              {SETTINGS_SECTION_DEFINITIONS.map((section, index) => (
                <PressButton
                  key={section.id}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  type="button"
                  id={`${section.id}-tab`}
                  role="tab"
                  aria-selected={section.id === activeSection.id}
                  aria-controls={`${section.id}-panel`}
                  tabIndex={section.id === activeSection.id ? 0 : -1}
                  className={`settings-nav-item${
                    section.id === activeSection.id ? " is-active" : ""
                  }`}
                  onClick={() => handleSelectSection(section.id)}
                  onKeyDown={handleSectionKeyDown(index)}
                >
                  {section.label}
                </PressButton>
              ))}
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
            <div
              key={activeSection.id}
              id={`${activeSection.id}-panel`}
              role="tabpanel"
              aria-labelledby={`${activeSection.id}-tab`}
              className="settings-tab-panel"
            >
              {activeSection.render({
                open,
                onCaptureChange: setCaptureActive,
                onOpenCacheLocation,
                onClearCache,
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
