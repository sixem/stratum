// Shared browsing defaults for grid and list views in both panes.
import { shallow } from "zustand/shallow";
import { PressButton } from "@/components/primitives/PressButton";
import { resolveDefaultViewMode, useSettingsStore } from "@/modules/settings.store";
import { SettingsGroup, SettingsItem, SettingsToggleItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const FILE_VIEW_DEFAULTS_ITEMS = {
  defaultView: {
    label: "Default view",
    description: "Used for new tabs in both panes. Last used follows the most recent view choice.",
    keywords: "list thumbnails grid remember",
  },
  smoothScrolling: {
    label: "Smooth scrolling",
    description: "Scroll smoothly when using the mouse wheel.",
  },
  parentEntry: {
    label: "Parent directory entry",
    description: "Show an entry that opens the parent folder.",
  },
  keepFilter: {
    label: "Keep filter when changing folders",
    description: "Carry the current filter into the next folder in the same tab, in either pane.",
  },
} satisfies Record<string, SettingsItemText>;

const DEFAULT_VIEW_OPTIONS = [
  { value: "thumbs", label: "Grid" },
  { value: "list", label: "List" },
  { value: "last", label: "Last used" },
] as const;

export const SettingsFileViewDefaults = ({ sectionId }: { sectionId: string }) => {
  const { defaultViewMode, smoothScroll, showParentEntry, keepFilterOnNavigation, updateSettings } = useSettingsStore(
    (state) => ({
      defaultViewMode: state.defaultViewMode,
      smoothScroll: state.smoothScroll,
      showParentEntry: state.showParentEntry,
      keepFilterOnNavigation: state.keepFilterOnNavigation,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );

  return (
    <SettingsGroup id={sectionId} title="Browsing" items={Object.values(FILE_VIEW_DEFAULTS_ITEMS)}>
      <SettingsItem item={FILE_VIEW_DEFAULTS_ITEMS.defaultView}>
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
      <SettingsToggleItem item={FILE_VIEW_DEFAULTS_ITEMS.smoothScrolling} checked={smoothScroll}
        onChange={(smoothScroll) => updateSettings({ smoothScroll })} />
      <SettingsToggleItem item={FILE_VIEW_DEFAULTS_ITEMS.parentEntry} checked={showParentEntry}
        onChange={(showParentEntry) => updateSettings({ showParentEntry })} />
      <SettingsToggleItem item={FILE_VIEW_DEFAULTS_ITEMS.keepFilter} checked={keepFilterOnNavigation}
        onChange={(keepFilterOnNavigation) => updateSettings({ keepFilterOnNavigation })} />
    </SettingsGroup>
  );
};
