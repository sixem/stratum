// Startup preferences, safety prompts, and diagnostics.
import { shallow } from "zustand/shallow";
import { useSettingsStore } from "@/modules/settings.store";

import { SettingsToggleItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";
import { NAVIGATION_SETTINGS_ITEMS, SettingsNavigationDefaults } from "./SettingsNavigationDefaults";
import { DIAGNOSTICS_SETTINGS_ITEM, SettingsDiagnostics } from "./SettingsDiagnostics";

export const GENERAL_SETTINGS_ITEMS = {
  ...NAVIGATION_SETTINGS_ITEMS,
  confirmDeletes: {
    label: "Confirm deletes",
    description: "Ask before sending items to the trash.",
  },
  confirmClose: {
    label: "Confirm on close",
    description: "Show a confirmation dialog before closing the app window.",
  },
  warnOnUnsavedWorkspaces: {
    label: "Warn about unsaved workspaces",
    description: "Choose which changed workspaces to save before exiting.",
    keywords: "close quit exit draft",
  },
  diagnostics: DIAGNOSTICS_SETTINGS_ITEM,
} satisfies Record<string, SettingsItemText>;

type SettingsGeneralSectionProps = {
  sectionId: string;
  open: boolean;
};

export const SettingsGeneralSection = ({ sectionId, open }: SettingsGeneralSectionProps) => {
  const {
    confirmDelete,
    confirmClose,
    warnOnUnsavedWorkspaces,
    updateSettings,
  } = useSettingsStore(
    (state) => ({
      confirmDelete: state.confirmDelete,
      confirmClose: state.confirmClose,
      warnOnUnsavedWorkspaces: state.warnOnUnsavedWorkspaces,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">General</div>
      <SettingsNavigationDefaults />
      <SettingsToggleItem
        item={GENERAL_SETTINGS_ITEMS.confirmDeletes}
        checked={confirmDelete}
        onChange={(confirmDelete) => updateSettings({ confirmDelete })}
      />
      <SettingsToggleItem
        item={GENERAL_SETTINGS_ITEMS.confirmClose}
        checked={confirmClose}
        onChange={(confirmClose) => updateSettings({ confirmClose })}
      />
      <SettingsToggleItem
        item={GENERAL_SETTINGS_ITEMS.warnOnUnsavedWorkspaces}
        checked={warnOnUnsavedWorkspaces}
        onChange={(warnOnUnsavedWorkspaces) => updateSettings({ warnOnUnsavedWorkspaces })}
      />
      <SettingsDiagnostics open={open} />
    </section>
  );
};
