// Custom keybind capture and management UI.
import { useEffect, useState } from "react";
import type { KeybindAction, KeybindMap } from "@/modules";
import {
  DEFAULT_KEYBINDS,
  KEYBIND_DEFINITIONS,
  buildKeybindFromEvent,
  formatKeybind,
  getReservedKeybindLabel,
  isBareCharacterKeybind,
  normalizeKeybind,
} from "@/modules";
import type { SettingsUpdateHandler } from "./types";

type SettingsKeybindsSectionProps = {
  sectionId: string;
  open: boolean;
  keybinds: KeybindMap;
  onUpdate: SettingsUpdateHandler;
  onCaptureChange?: (active: boolean) => void;
};

export function SettingsKeybindsSection({
  sectionId,
  open,
  keybinds,
  onUpdate,
  onCaptureChange,
}: SettingsKeybindsSectionProps) {
  const [captureAction, setCaptureAction] = useState<KeybindAction | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    onCaptureChange?.(Boolean(captureAction));
  }, [captureAction, onCaptureChange]);

  useEffect(() => {
    if (open) return;
    setCaptureAction(null);
    setCaptureError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !captureAction) return;
    const handleKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCaptureAction(null);
        setCaptureError(null);
        return;
      }
      if (event.repeat) return;
      const next = buildKeybindFromEvent(event);
      if (!next) return;
      const normalized = normalizeKeybind(next);
      if (!normalized) return;
      const reservedLabel = getReservedKeybindLabel(normalized);
      if (reservedLabel) {
        setCaptureError(`That shortcut is reserved for ${reservedLabel}.`);
        return;
      }
      if (isBareCharacterKeybind(normalized)) {
        setCaptureError("Use Ctrl or Alt with single-character shortcuts.");
        return;
      }
      const conflict = KEYBIND_DEFINITIONS.find((definition) => {
        if (definition.id === captureAction) return false;
        return normalizeKeybind(keybinds[definition.id]) === normalized;
      });
      if (conflict) {
        setCaptureError(`Already used by ${conflict.label}.`);
        return;
      }
      onUpdate({
        keybinds: {
          ...keybinds,
          [captureAction]: normalized,
        },
      });
      setCaptureAction(null);
      setCaptureError(null);
    };

    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, [captureAction, keybinds, onUpdate, open]);

  const handleStartCapture = (action: KeybindAction) => {
    if (!open) return;
    if (captureAction === action) {
      setCaptureAction(null);
      setCaptureError(null);
      return;
    }
    setCaptureAction(action);
    setCaptureError(null);
  };

  const handleResetKeybind = (action: KeybindAction) => {
    onUpdate({ keybinds: { ...keybinds, [action]: DEFAULT_KEYBINDS[action] } });
  };

  const handleResetKeybinds = () => {
    onUpdate({ keybinds: { ...DEFAULT_KEYBINDS } });
  };

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Keybinds</div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Custom shortcuts</div>
          <div className="settings-desc">
            Click a shortcut to rebind it. Press Escape to cancel.
          </div>
        </div>
        <div className="settings-actions">
          <button type="button" className="btn ghost" onClick={handleResetKeybinds}>
            Reset all
          </button>
        </div>
      </div>
      {KEYBIND_DEFINITIONS.map((definition) => {
        const current = keybinds[definition.id];
        const normalizedCurrent = normalizeKeybind(current);
        const normalizedDefault = normalizeKeybind(DEFAULT_KEYBINDS[definition.id]);
        const isCapturing = captureAction === definition.id;
        const showError = isCapturing && Boolean(captureError);
        const displayLabel = isCapturing
          ? "Press keys..."
          : formatKeybind(current) || "Unassigned";
        return (
          <div className="settings-item" key={definition.id}>
            <div>
              <div className="settings-label">{definition.label}</div>
              <div className="settings-desc">{definition.description}</div>
              {showError ? (
                <div className="settings-desc settings-desc-error">{captureError}</div>
              ) : null}
            </div>
            <div className="settings-actions">
              <button
                type="button"
                className={`keybind-button${isCapturing ? " is-capturing" : ""}${
                  showError ? " is-error" : ""
                }`}
                onClick={() => handleStartCapture(definition.id)}
              >
                {displayLabel}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={normalizedCurrent === normalizedDefault}
                onClick={() => handleResetKeybind(definition.id)}
              >
                Reset
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
