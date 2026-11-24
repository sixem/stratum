// Custom keybind capture and management UI.
import { useCallback, useEffect, useState } from "react";
import { shallow } from "zustand/shallow";
import type { KeybindAction } from "@/modules";
import {
  DEFAULT_KEYBINDS,
  KEYBIND_DEFINITIONS,
  buildKeybindFromEvent,
  formatKeybind,
  getReservedKeybindLabel,
  isBareCharacterKeybind,
  normalizeKeybind,
  useSettingsStore,
} from "@/modules";
import { PressButton } from "@/components/primitives/PressButton";

import { SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const KEYBINDS_SETTINGS_ITEMS = {
  customShortcuts: {
    label: "Custom shortcuts",
    description: "Click a shortcut to assign it. Press Escape to cancel.",
    keywords: "clear unassigned reset keybindings",
  },
  smartTabJump: {
    label: "Smart Tab jump",
    description: "Double-tap Tab to jump to the top or bottom of the current view.",
  },
} satisfies Record<string, SettingsItemText>;

type SettingsKeybindsSectionProps = {
  sectionId: string;
  open: boolean;
  onCaptureChange?: (active: boolean) => void;
};

export const SettingsKeybindsSection = ({
  sectionId,
  open,
  onCaptureChange,
}: SettingsKeybindsSectionProps) => {
  const { keybinds, smartTabJump, updateSettings } = useSettingsStore(
    (state) => ({
      keybinds: state.keybinds,
      smartTabJump: state.smartTabJump,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const [captureAction, setCaptureAction] = useState<KeybindAction | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const commitKeybind = useCallback(
    (action: KeybindAction, normalized: string) => {
      const reservedLabel = getReservedKeybindLabel(normalized);
      if (reservedLabel) {
        setCaptureError(`That shortcut is reserved for ${reservedLabel}.`);
        return false;
      }
      if (isBareCharacterKeybind(normalized)) {
        setCaptureError("Use Ctrl or Alt with single-character shortcuts.");
        return false;
      }
      const conflict = KEYBIND_DEFINITIONS.find((definition) => {
        if (definition.id === action) return false;
        return normalizeKeybind(keybinds[definition.id]) === normalized;
      });
      if (conflict) {
        setCaptureError(`Already used by ${conflict.label}.`);
        return false;
      }
      updateSettings({
        keybinds: {
          ...keybinds,
          [action]: normalized,
        },
      });
      setCaptureAction(null);
      setCaptureError(null);
      return true;
    },
    [keybinds, updateSettings],
  );

  useEffect(() => {
    onCaptureChange?.(Boolean(captureAction));
    return () => {
      onCaptureChange?.(false);
    };
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
      commitKeybind(captureAction, normalized);
    };

    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, [captureAction, commitKeybind, open]);

  useEffect(() => {
    if (!open || captureAction !== "previewItem") return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      const normalized = normalizeKeybind("MouseMiddle");
      if (!normalized) return;
      commitKeybind(captureAction, normalized);
    };
    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, [captureAction, commitKeybind, open]);

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
    updateSettings({ keybinds: { ...keybinds, [action]: DEFAULT_KEYBINDS[action] } });
  };

  const handleResetKeybinds = () => {
    updateSettings({ keybinds: { ...DEFAULT_KEYBINDS } });
  };

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Keybinds</div>
      <SettingsItem item={KEYBINDS_SETTINGS_ITEMS.customShortcuts}>
        <div className="settings-actions">
          <PressButton type="button" className="btn ghost" onClick={handleResetKeybinds}>
            Reset all
          </PressButton>
        </div>
      </SettingsItem>
      <SettingsItem item={KEYBINDS_SETTINGS_ITEMS.smartTabJump}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={smartTabJump}
            onChange={(event) =>
              updateSettings({ smartTabJump: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
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
          <SettingsItem
            item={definition}
            key={definition.id}
            details={showError ? <div className="settings-desc settings-desc-error">{captureError}</div> : null}
          >
            <div className="settings-actions">
              <PressButton
                type="button"
                className={`keybind-button${isCapturing ? " is-capturing" : ""}${
                  showError ? " is-error" : ""
                }`}
                onClick={() => handleStartCapture(definition.id)}
                onBlur={() => {
                  if (!isCapturing) return;
                  setCaptureAction(null);
                  setCaptureError(null);
                }}
              >
                {displayLabel}
              </PressButton>
              <PressButton
                type="button"
                className="btn ghost"
                aria-label={`Clear ${definition.label} shortcut`}
                disabled={!normalizedCurrent}
                onClick={() => updateSettings({ keybinds: { ...keybinds, [definition.id]: "" } })}
              >
                Clear
              </PressButton>
              <PressButton
                type="button"
                className="btn ghost"
                aria-label={`Reset ${definition.label} shortcut`}
                disabled={normalizedCurrent === normalizedDefault || Boolean(normalizedDefault && KEYBIND_DEFINITIONS.some(
                  ({ id }) => id !== definition.id && normalizeKeybind(keybinds[id]) === normalizedDefault,
                ))}
                onClick={() => handleResetKeybind(definition.id)}
              >
                Reset
              </PressButton>
            </div>
          </SettingsItem>
        );
      })}
    </section>
  );
};
