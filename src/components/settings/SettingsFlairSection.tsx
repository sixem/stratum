// Visual flair toggles (accent + ambient effects).
import type { AccentTheme } from "@/modules";
import { PressButton } from "@/components/primitives/PressButton";
import type { SettingsUpdateHandler } from "./types";

type SettingsFlairSectionProps = {
  sectionId: string;
  accentTheme: AccentTheme;
  categoryTinting: boolean;
  ambientBackground: boolean;
  blurOverlays: boolean;
  onUpdate: SettingsUpdateHandler;
};

const ACCENT_THEMES: { id: AccentTheme; label: string }[] = [
  { id: "red", label: "Red" },
  { id: "purple", label: "Purple" },
  { id: "green", label: "Green" },
  { id: "yellow", label: "Yellow" },
  { id: "orange", label: "Orange" },
  { id: "teal", label: "Teal" },
  { id: "white", label: "White" },
];

export const SettingsFlairSection = ({
  sectionId,
  accentTheme,
  categoryTinting,
  ambientBackground,
  blurOverlays,
  onUpdate,
}: SettingsFlairSectionProps) => {
  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Flair</div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Accent color</div>
          <div className="settings-desc">Tint highlights and accents.</div>
        </div>
        <div className="settings-pills" role="group" aria-label="Accent color">
          {ACCENT_THEMES.map((theme) => (
            <PressButton
              key={theme.id}
              type="button"
              data-accent={theme.id}
              className={`settings-pill${accentTheme === theme.id ? " is-active" : ""}`}
              onClick={() => onUpdate({ accentTheme: theme.id })}
            >
              <span className="settings-swatch" aria-hidden="true" />
              {theme.label}
            </PressButton>
          ))}
        </div>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Category tints</div>
          <div className="settings-desc">
            Subtle color cues for file types in grid and list views.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={categoryTinting}
            onChange={(event) => onUpdate({ categoryTinting: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Ambient background</div>
          <div className="settings-desc">Slow moving gradient glow behind the UI.</div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={ambientBackground}
            onChange={(event) => onUpdate({ ambientBackground: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Blur overlays</div>
          <div className="settings-desc">Backdrop blur for tooltips and menus.</div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={blurOverlays}
            onChange={(event) => onUpdate({ blurOverlays: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
    </section>
  );
};
