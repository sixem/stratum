// List display preferences shared by both file panes.
import { SettingsPills } from "./SettingsPills";
import { PressButton } from "@/components/primitives/PressButton";
import { LIST_COLUMN_OPTIONS } from "@/constants/settings";
import { useSettingsStore } from "@/modules";
import type { ListDensity } from "@/modules/settings.types";
import { SettingsGroup, SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const LIST_SETTINGS_ITEMS = {
  density: {
    label: "Row spacing",
    description: "Choose how much space list rows use in both panes.",
    keywords: "list density row height compact comfortable",
  },
  columns: {
    label: "Visible columns",
    description: "Name is always shown. You can also change columns from the list header menu.",
    keywords: "list size modified date columns",
  },
} satisfies Record<string, SettingsItemText>;

const DENSITIES: { value: ListDensity; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
];

export const SettingsListSection = ({ sectionId }: { sectionId: string }) => {
  const density = useSettingsStore((state) => state.listDensity);
  const showSize = useSettingsStore((state) => state.listShowSize);
  const showModified = useSettingsStore((state) => state.listShowModified);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const visibleColumns = { listShowSize: showSize, listShowModified: showModified };

  return (
    <SettingsGroup id={sectionId} title="List" items={Object.values(LIST_SETTINGS_ITEMS)}>
      <SettingsItem item={LIST_SETTINGS_ITEMS.density}>
        <SettingsPills aria-label="Row spacing">
          {DENSITIES.map(({ value, label }) => (
            <PressButton
              key={value}
              type="button"
              aria-pressed={density === value}
              className={`settings-pill${density === value ? " is-active" : ""}`}
              onClick={() => updateSettings({ listDensity: value })}
            >
              {label}
            </PressButton>
          ))}
        </SettingsPills>
      </SettingsItem>
      <SettingsItem item={LIST_SETTINGS_ITEMS.columns}>
        <SettingsPills aria-label="Visible columns">
          {LIST_COLUMN_OPTIONS.map(({ key, label }) => (
            <PressButton
              key={key}
              type="button"
              aria-pressed={visibleColumns[key]}
              className={`settings-pill${visibleColumns[key] ? " is-active" : ""}`}
              onClick={() => updateSettings({ [key]: !visibleColumns[key] })}
            >
              {label}
            </PressButton>
          ))}
        </SettingsPills>
      </SettingsItem>
    </SettingsGroup>
  );
};
