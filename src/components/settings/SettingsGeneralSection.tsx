// General settings and view defaults that shape navigation and layout.
import { useId } from "react";
import { shallow } from "zustand/shallow";
import { PressButton } from "@/components/primitives/PressButton";
import { useSettingsStore } from "@/modules";

import { SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const GENERAL_SETTINGS_ITEMS = {
  defaultView: {
    label: "Default view",
    description: "Used for new tabs and new sessions.",
    keywords: "list thumbnails grid",
  },
  smoothScrolling: {
    label: "Smooth scrolling",
    description: "Keep the original smooth wheel scroll instead of snapping by row.",
  },
  centerGridItems: {
    label: "Center grid items",
    description: "Center the grid within the viewport. Will not have an effect with autosized grids.",
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
} satisfies Record<string, SettingsItemText>;

type SettingsGeneralSectionProps = {
  sectionId: string;
};

export const SettingsGeneralSection = ({ sectionId }: SettingsGeneralSectionProps) => {
  const keepFilterId = useId();
  const keepFilterDescriptionId = useId();
  const {
    defaultViewMode,
    smoothScroll,
    gridCentered,
    showParentEntry,
    keepFilterOnNavigation,
    confirmDelete,
    confirmClose,
    updateSettings,
  } = useSettingsStore(
    (state) => ({
      defaultViewMode: state.defaultViewMode,
      smoothScroll: state.smoothScroll,
      gridCentered: state.gridCentered,
      showParentEntry: state.showParentEntry,
      keepFilterOnNavigation: state.keepFilterOnNavigation,
      confirmDelete: state.confirmDelete,
      confirmClose: state.confirmClose,
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
      <SettingsItem item={GENERAL_SETTINGS_ITEMS.centerGridItems}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={gridCentered}
            onChange={(event) => updateSettings({ gridCentered: event.currentTarget.checked })}
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
    </section>
  );
};
