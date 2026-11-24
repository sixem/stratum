// First-run choices are staged here and saved together when setup is accepted.
import { useId, useRef, useState } from "react";
import { CheckmarkIcon, StratumBrandIcon } from "@/components/icons";
import { ACCENT_THEMES } from "@/constants/settings";
import { useModalFocusTrap } from "@/hooks/ui/app/useModalFocusTrap";
import { useSettingsStore } from "@/modules/settings.store";
import type { WelcomeSettings } from "@/modules/welcome";
import type { ViewMode } from "@/types";
import { DialogCloseButton } from "../DialogCloseButton";
import { TooltipWrapper } from "../Tooltip";
import { WelcomeViewPreview } from "./WelcomeViewPreview";

const VIEW_OPTIONS = [
  { id: "list", label: "List", description: "Names and file details" },
  { id: "thumbs", label: "Grid", description: "Larger file thumbnails" },
] as const satisfies readonly { id: ViewMode; label: string; description: string }[];

type WelcomeSetupProps = {
  onFinish: (settings?: WelcomeSettings) => void;
};

export const WelcomeSetup = ({ onFinish }: WelcomeSetupProps) => {
  const id = useId();
  const panelRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<WelcomeSettings>(() => {
    const { darkMode, accentTheme, defaultViewMode } = useSettingsStore.getState();
    return { darkMode, accentTheme, defaultViewMode };
  });
  useModalFocusTrap({ open: true, containerRef: panelRef, initialFocusRef: panelRef });

  return (
    <div className="welcome-modal">
      <form
        ref={panelRef}
        className="welcome-panel"
        data-accent={draft.accentTheme}
        data-darker={draft.darkMode || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          onFinish(draft);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onFinish();
        }}
      >
        <header className="welcome-header">
          <StratumBrandIcon className="welcome-logo" />
          <div>
            <h2 id={`${id}-title`}>Set up your workspace</h2>
            <p id={`${id}-description`}>Choose how Stratum looks and feels.</p>
          </div>
          <DialogCloseButton label="Skip workspace setup" onClose={() => onFinish()} />
        </header>

        <div className="welcome-appearance">
          <fieldset className="welcome-group">
            <legend>Theme</legend>
            <div className="welcome-themes">
              {[false, true].map((darkMode) => (
                <label className="welcome-theme welcome-choice" key={String(darkMode)}>
                  <input
                    type="radio"
                    name={`${id}-theme`}
                    checked={draft.darkMode === darkMode}
                    onChange={() => setDraft((current) => ({ ...current, darkMode }))}
                  />
                  {darkMode ? "Darker" : "Dark"}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="welcome-group">
            <legend>Flair color</legend>
            <div className="welcome-color-options">
              {ACCENT_THEMES.map(({ id: accentTheme, label }) => (
                <TooltipWrapper key={accentTheme} text={label}>
                  <label className="welcome-swatch welcome-choice" data-color={accentTheme}>
                    <input
                      type="radio"
                      name={`${id}-flair`}
                      aria-label={label}
                      checked={draft.accentTheme === accentTheme}
                      onChange={() => setDraft((current) => ({ ...current, accentTheme }))}
                    />
                    <span aria-hidden="true"><CheckmarkIcon /></span>
                  </label>
                </TooltipWrapper>
              ))}
            </div>
          </fieldset>
        </div>

        <fieldset className="welcome-group welcome-browsing">
          <legend>How do you browse?</legend>
          <p>Choose a default view for your files.</p>
          <div className="welcome-view-options">
            {VIEW_OPTIONS.map(({ id: defaultViewMode, label, description }) => (
              <label className="welcome-view welcome-choice" key={defaultViewMode}>
                <input
                  type="radio"
                  name={`${id}-view`}
                  aria-label={label}
                  aria-describedby={`${id}-${defaultViewMode}-description`}
                  checked={draft.defaultViewMode === defaultViewMode}
                  onChange={() => setDraft((current) => ({ ...current, defaultViewMode }))}
                />
                <WelcomeViewPreview mode={defaultViewMode} />
                <span className="welcome-view-caption">
                  <span className="welcome-view-label">{label}</span>
                  <span className="welcome-view-description" id={`${id}-${defaultViewMode}-description`}>
                    {description}
                  </span>
                  <span className="welcome-view-check" aria-hidden="true"><CheckmarkIcon /></span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <footer className="welcome-footer">
          <p>Change these later in Settings.</p>
          <div className="welcome-actions">
            <button type="button" className="welcome-skip" onClick={() => onFinish()}>Skip setup</button>
            <button type="submit" className="welcome-start">Get started</button>
          </div>
        </footer>
      </form>
    </div>
  );
};
