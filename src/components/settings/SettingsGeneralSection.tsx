// General settings and view defaults that shape navigation and layout.
import { shallow } from "zustand/shallow";
import { PressButton } from "@/components/primitives/PressButton";
import { resolveDefaultViewMode, useSettingsStore } from "@/modules/settings.store";

import { SettingsItem, SettingsToggleItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";
import { NAVIGATION_SETTINGS_ITEMS, SettingsNavigationDefaults } from "./SettingsNavigationDefaults";
import { DIAGNOSTICS_SETTINGS_ITEM, SettingsDiagnostics } from "./SettingsDiagnostics";

const DEFAULT_VIEW_OPTIONS = [
  { value: "thumbs", label: "Grid" },
  { value: "list", label: "List" },
  { value: "last", label: "Last used" },
] as const;

export const GENERAL_SETTINGS_ITEMS = {
  defaultView: {
    label: "Default view",
    description: "Used for new tabs in both panes. Last used follows the most recent view choice.",
    keywords: "list thumbnails grid remember",
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
          {DEFAULT_VIEW_OPTIONS.map(({ value, label }) => (
            <PressButton
              key={value}
              type="button"
              className={`settings-pill${defaultViewMode === value ? " is-active" : ""}`}
              aria-pressed={defaultViewMode === value}
              onClick={() => {
                if (defaultViewMode === value) return;
                const current = useSettingsStore.getState();
                if (value === "last" && current.lastUsedViewMode === null) {
                  updateSettings({ defaultViewMode: value, lastUsedViewMode: resolveDefaultViewMode(current) });
                } else {
                  updateSettings({ defaultViewMode: value });
                }
              }}
            >
              {label}
            </PressButton>
          ))}
        </div>
      </SettingsItem>
      <SettingsNavigationDefaults />
      <SettingsToggleItem
        item={GENERAL_SETTINGS_ITEMS.smoothScrolling}
        checked={smoothScroll}
        onChange={(smoothScroll) => updateSettings({ smoothScroll })}
      />
      <SettingsToggleItem
        item={GENERAL_SETTINGS_ITEMS.parentEntry}
        checked={showParentEntry}
        onChange={(showParentEntry) => updateSettings({ showParentEntry })}
      />
      <SettingsToggleItem
        item={GENERAL_SETTINGS_ITEMS.keepFilter}
        checked={keepFilterOnNavigation}
        onChange={(keepFilterOnNavigation) => updateSettings({ keepFilterOnNavigation })}
      />
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
