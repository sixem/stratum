// General settings and view defaults that shape navigation and layout.
import { useId } from "react";
import { shallow } from "zustand/shallow";
import { PressButton } from "@/components/primitives/PressButton";
import { useSettingsStore } from "@/modules";

import { SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";
import { NAVIGATION_SETTINGS_ITEMS, SettingsNavigationDefaults } from "./SettingsNavigationDefaults";
import { DIAGNOSTICS_SETTINGS_ITEM, SettingsDiagnostics } from "./SettingsDiagnostics";

export const GENERAL_SETTINGS_ITEMS = {
  defaultView: {
    label: "Default view",
    description: "Used for new tabs and new sessions.",
    keywords: "list thumbnails grid",
  },
  ...NAVIGATION_SETTINGS_ITEMS,
  smoothScrolling: {
    label: "Smooth scrolling",
    description: "Keep the original smooth wheel scroll instead of snapping by row.",
  },
  parentEntry: {
    label: "Parent directory entry",
    description: "Show a pseudo entry for moving up one level.",
  },
  keepFilter: {
    label: "Keep filter when changing folders",
    description: "Carry the current filter into the next folder in the same tab, in either pane.",
  },
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
  const keepFilterId = useId();
  const keepFilterDescriptionId = useId();
  const workspaceWarningId = useId();
  const workspaceWarningDescriptionId = useId();
  const {
    defaultViewMode,
    smoothScroll,
    showParentEntry,
    keepFilterOnNavigation,
    confirmDelete,
    confirmClose,
    warnOnUnsavedWorkspaces,
    updateSettings,
  } = useSettingsStore(
    (state) => ({
      defaultViewMode: state.defaultViewMode,
      smoothScroll: state.smoothScroll,
      showParentEntry: state.showParentEntry,
      keepFilterOnNavigation: state.keepFilterOnNavigation,
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
      <SettingsItem item={GENERAL_SETTINGS_ITEMS.defaultView}>
        <div className="settings-pills" role="group" aria-label="Default view">
          <PressButton
            type="button"
            className={`settings-pill${defaultViewMode === "thumbs" ? " is-active" : ""}`}
            onClick={() => updateSettings({ defaultViewMode: "thumbs" })}
          >
            Grid
          </PressButton>
          <PressButton
            type="button"
            className={`settings-pill${defaultViewMode === "list" ? " is-active" : ""}`}
            onClick={() => updateSettings({ defaultViewMode: "list" })}
          >
            List
          </PressButton>
        </div>
      </SettingsItem>
      <SettingsNavigationDefaults />
      <SettingsItem item={GENERAL_SETTINGS_ITEMS.smoothScrolling}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={smoothScroll}
            onChange={(event) => updateSettings({ smoothScroll: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={GENERAL_SETTINGS_ITEMS.parentEntry}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={showParentEntry}
            onChange={(event) => updateSettings({ showParentEntry: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem
        item={GENERAL_SETTINGS_ITEMS.keepFilter}
        labelFor={keepFilterId}
        descriptionId={keepFilterDescriptionId}
      >
        <label className="settings-toggle">
          <input
            type="checkbox"
            id={keepFilterId}
            aria-describedby={keepFilterDescriptionId}
            checked={keepFilterOnNavigation}
            onChange={(event) => updateSettings({ keepFilterOnNavigation: event.currentTarget.checked })}
          />
          <span aria-hidden="true" />
        </label>
      </SettingsItem>
      <SettingsItem item={GENERAL_SETTINGS_ITEMS.confirmDeletes}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={confirmDelete}
            onChange={(event) => updateSettings({ confirmDelete: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={GENERAL_SETTINGS_ITEMS.confirmClose}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={confirmClose}
            onChange={(event) => updateSettings({ confirmClose: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem
        item={GENERAL_SETTINGS_ITEMS.warnOnUnsavedWorkspaces}
        labelFor={workspaceWarningId}
        descriptionId={workspaceWarningDescriptionId}
      >
        <label className="settings-toggle">
          <input
            id={workspaceWarningId}
            type="checkbox"
            aria-describedby={workspaceWarningDescriptionId}
            checked={warnOnUnsavedWorkspaces}
            onChange={(event) => updateSettings({ warnOnUnsavedWorkspaces: event.currentTarget.checked })}
          />
          <span aria-hidden="true" />
        </label>
      </SettingsItem>
      <SettingsDiagnostics open={open} />
    </section>
  );
};
