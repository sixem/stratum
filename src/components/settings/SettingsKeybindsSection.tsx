// Custom keybind capture and management UI.
import { useCallback, useEffect, useState } from "react";
import { shallow } from "zustand/shallow";
import type { KeybindAction, KeybindDefinition } from "@/modules";
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
import { buildKeybindFromWheel } from "@/modules/keybinds";

import { SettingsGroup, SettingsItem, SettingsToggleItem } from "./SettingsItem";
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
  terminalTabNavigation: {
    label: "Tab navigation in terminal",
    description: "Use the Previous tab and Next tab shortcuts while a terminal has focus.",
    keywords: "powershell shell override keyboard scroll",
  },
} satisfies Record<string, SettingsItemText>;

const tabShortcuts = KEYBIND_DEFINITIONS.filter(({ id }) => id === "prevTab" || id === "nextTab");
const thumbnailShortcuts = KEYBIND_DEFINITIONS.filter(({ id }) => id === "increaseThumbnailSize" || id === "decreaseThumbnailSize");
const generalShortcuts = KEYBIND_DEFINITIONS.filter(item => !tabShortcuts.includes(item) && !thumbnailShortcuts.includes(item));
const generalItems = [KEYBINDS_SETTINGS_ITEMS.customShortcuts, KEYBINDS_SETTINGS_ITEMS.smartTabJump, ...generalShortcuts];
const tabItems = [KEYBINDS_SETTINGS_ITEMS.terminalTabNavigation, ...tabShortcuts];

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
  const { keybinds, smartTabJump, terminalTabNavigation, updateSettings } = useSettingsStore(
    (state) => ({
      keybinds: state.keybinds,
      smartTabJump: state.smartTabJump,
      terminalTabNavigation: state.terminalTabNavigation,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const [captureAction, setCaptureAction] = useState<KeybindAction | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const captureDefinition = KEYBIND_DEFINITIONS.find(({ id }) => id === captureAction);

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
        setCaptureError(`Already used by ${conflict.label}. Clear or change that shortcut first.`);
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
    if (!open || !captureDefinition?.wheel) return;
    const handleWheel = (event: WheelEvent) => {
      const binding = buildKeybindFromWheel(event);
      if (!binding || !event.cancelable) return;
      event.preventDefault();
      event.stopPropagation();
      commitKeybind(captureDefinition.id, binding);
    };

    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", handleWheel, true);
  }, [captureDefinition, commitKeybind, open]);

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

  const renderShortcut = (definition: KeybindDefinition) => {
    const current = keybinds[definition.id];
    const normalizedCurrent = normalizeKeybind(current);
    const normalizedDefault = normalizeKeybind(DEFAULT_KEYBINDS[definition.id]);
    const isCapturing = captureAction === definition.id;
    const showError = isCapturing && Boolean(captureError);
    const captureLabel = definition.wheel ? "Keys or modified scroll…" : "Press keys…";
    const displayLabel = isCapturing ? captureLabel : formatKeybind(current) || "Unassigned";
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
  };

  return (
    <>
      <SettingsGroup id={sectionId} title="General" items={generalItems}>
        <SettingsItem item={KEYBINDS_SETTINGS_ITEMS.customShortcuts}>
          <div className="settings-actions">
            <PressButton type="button" className="btn ghost" onClick={handleResetKeybinds}>
              Reset all
            </PressButton>
          </div>
        </SettingsItem>
        <SettingsToggleItem item={KEYBINDS_SETTINGS_ITEMS.smartTabJump} checked={smartTabJump}
          onChange={checked => updateSettings({ smartTabJump: checked })} />
        {generalShortcuts.map(renderShortcut)}
      </SettingsGroup>
      <SettingsGroup id={`${sectionId}-tabs`} title="Tab navigation" items={tabItems}>
        <SettingsToggleItem item={KEYBINDS_SETTINGS_ITEMS.terminalTabNavigation} checked={terminalTabNavigation}
          onChange={checked => updateSettings({ terminalTabNavigation: checked })} />
        {tabShortcuts.map(renderShortcut)}
      </SettingsGroup>
      <SettingsGroup id={`${sectionId}-thumbnails`} title="Thumbnail size" items={thumbnailShortcuts}>
        {thumbnailShortcuts.map(renderShortcut)}
      </SettingsGroup>
    </>
  );
};
