// Settings panel for view, flair, and thumbnail options.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { TabCloseIcon } from "@/components/icons";
import { SettingsSearchMatches } from "@/components/settings/SettingsItem";
import { SETTINGS_DIAGNOSTICS_ID } from "@/components/settings/SettingsDiagnostics";
import { OverlayPanelHeader } from "@/components/overlay/OverlayPanelHeader";
import { DialogCloseButton } from "./DialogCloseButton";
import {
  DEFAULT_SETTINGS_SECTION_ID,
  SETTINGS_SECTION_DEFINITIONS,
  searchSettingsSections,
  type SettingsSectionId,
} from "@/components/settings/settingsSectionRegistry";
import { PressButton } from "@/components/primitives/PressButton";
import { APP_VERSION } from "@/constants";
import { useModalFocusTrap } from "@/hooks";
import { handleSearchHotkey } from "@/hooks/ui/inputs/useSearchHotkey";
import { isPlainEscape } from "@/hooks/ui/inputs/inputFocus";
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
  const autoGrid = useSettingsStore((state) => state.gridSize === "auto");
  const moveHistoryEnabled = useSettingsStore((state) => state.rememberMoveDestinations);
  const titleId = useId();
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(
    DEFAULT_SETTINGS_SECTION_ID,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [captureActive, setCaptureActive] = useState(false);
  const [diagnosticsRequest, setDiagnosticsRequest] = useState(0);
  const shouldCloseRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeSection =
    useMemo(
      () =>
        SETTINGS_SECTION_DEFINITIONS.find((section) => section.id === activeSectionId) ??
        SETTINGS_SECTION_DEFINITIONS[0],
      [activeSectionId],
    );
  const searchResults = useMemo(
    () => searchSettingsSections(searchQuery, autoGrid, moveHistoryEnabled),
    [searchQuery, autoGrid, moveHistoryEnabled],
  );
  const searching = searchResults !== null;
  const matchingSections = new Set(searchResults?.map(({ section }) => section.id));
  const renderContext = { open, onCaptureChange: setCaptureActive, onOpenCacheLocation, onClearCache };

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeSectionId, searchQuery]);

  useLayoutEffect(() => {
    if (diagnosticsRequest === 0) return;
    const details = contentRef.current?.querySelector<HTMLDetailsElement>(`#${SETTINGS_DIAGNOSTICS_ID}`);
    if (!details) return;
    details.open = true;
    details.querySelector("summary")?.focus({ preventScroll: true });
    details.scrollIntoView({ block: "nearest" });
  }, [diagnosticsRequest]);

  useModalFocusTrap({
    open,
    containerRef: panelRef,
    initialFocusRef: closeButtonRef,
  });

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (!isPlainEscape(event)) return;
      if (captureActive) return;
      onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [captureActive, onClose, open]);

  useEffect(() => {
    if (open) return;
    setCaptureActive(false);
    setSearchQuery("");
  }, [open]);

  const handleSelectSection = useCallback((id: SettingsSectionId) => {
    setActiveSectionId(id);
    setCaptureActive(false);
    setSearchQuery("");
  }, []);

  const handleOpenDiagnostics = () => {
    handleSelectSection("settings-general");
    setDiagnosticsRequest((request) => request + 1);
  };

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    searchInputRef.current?.focus({ preventScroll: true });
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
      if (!searching) handleSelectSection(nextSection.id);
      tabRefs.current[nextIndex]?.focus();
    },
    [handleSelectSection, searching],
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
        inert={!open}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          handleSearchHotkey(event, searchInputRef.current, clearSearch);
        }}
      >
        <OverlayPanelHeader
          className="settings-header"
          titleClassName="settings-title"
          subtitleClassName="settings-subtitle"
          title="Settings"
          titleId={titleId}
          subtitle="Manage app behavior, indexing, flair, thumbnails, and cached previews."
          actions={<DialogCloseButton ref={closeButtonRef} onClose={onClose} />}
        />
        <div className="settings-body">
          <nav className="settings-sidebar" aria-label="Settings sections">
            <div className="settings-nav" data-searching={searching} role={searching ? undefined : "tablist"}>
              {SETTINGS_SECTION_DEFINITIONS.map((section, index) => {
                const selected = !searching && section.id === activeSection.id;
                const matching = matchingSections.has(section.id);
                return (
                  <PressButton
                    key={section.id}
                    ref={(element) => {
                      tabRefs.current[index] = element;
                    }}
                    type="button"
                    id={`${section.id}-tab`}
                    role={searching ? undefined : "tab"}
                    aria-selected={searching ? undefined : selected}
                    aria-controls={selected ? `${section.id}-panel` : undefined}
                    tabIndex={searching || selected ? 0 : -1}
                    className={`settings-nav-item${selected ? " is-active" : ""}${matching ? " is-search-match" : ""}`}
                    onClick={() => handleSelectSection(section.id)}
                    onKeyDown={handleSectionKeyDown(index)}
                  >
                    {section.label}
                  </PressButton>
                );
              })}
            </div>
          </nav>
          <div className="settings-main">
            <div className="settings-search-field">
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Search settings…"
                aria-label="Search settings"
                spellCheck={false}
                autoComplete="off"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
              />
              {searchQuery ? (
                <button
                  className="settings-search-clear"
                  type="button"
                  aria-label="Clear settings search"
                  onClick={clearSearch}
                >
                  <TabCloseIcon />
                </button>
              ) : null}
            </div>
            <div className="settings-content" ref={contentRef}>
              {searchResults ? (
                <div className="settings-search-results">
                  {searchResults.length === 0 ? (
                    <p className="settings-search-empty" role="status">No settings match your search.</p>
                  ) : searchResults.map(({ section, matches }) => (
                    <SettingsSearchMatches.Provider key={section.id} value={matches}>
                      {section.render(renderContext)}
                    </SettingsSearchMatches.Provider>
                  ))}
                </div>
              ) : (
                <div
                  key={activeSection.id}
                  id={`${activeSection.id}-panel`}
                  role="tabpanel"
                  aria-labelledby={`${activeSection.id}-tab`}
                  className="settings-tab-panel"
                >
                  {activeSection.render(renderContext)}
                </div>
              )}
            </div>
          </div>
        </div>
        <footer className="settings-footer">
          <span className="tnum">v{APP_VERSION}</span>
          <PressButton
            type="button"
            className="settings-footer-button"
            pressOnPointerDown={false}
            onClick={handleOpenDiagnostics}
          >
            Diagnostics
          </PressButton>
          <PressButton type="button" className="settings-footer-button settings-footer-reset" onClick={handleResetSettings}>
            Reset settings
          </PressButton>
        </footer>
      </div>
    </div>
  );
};
