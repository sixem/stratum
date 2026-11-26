// Update preferences share the same controls and search index as other settings.
import { useSettingsStore } from "@/modules/settings.store";
import { useUpdateStore } from "@/modules/updateStore";
import { DropdownSelect } from "@/components/primitives/DropdownSelect";
import { PressButton } from "@/components/primitives/PressButton";
import { SettingsGroup, SettingsItem, SettingsToggleItem } from "./SettingsItem";

export const UPDATE_SETTINGS_ITEMS = {
  automatic: {
    label: "Automatically check for updates",
    description: "Check once a day and show available updates in the status bar.",
  },
  delay: {
    label: "Wait before offering new releases",
    description: "Count from publication. You can always check manually.",
    keywords: "delay threshold age days hours",
  },
  check: {
    label: "Check for updates",
    description: "Look for the latest stable release now.",
  },
};

const delays = [
  { hours: 0, label: "Off" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
] as const;
const groups = [{ id: "delay", options: delays.map(({ hours, label }) => ({ value: String(hours), label })) }];

export const SettingsUpdatesSection = () => {
  const automatic = useSettingsStore((state) => state.autoCheckUpdates);
  const delay = useSettingsStore((state) => state.updateDelayHours);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  return (
    <SettingsGroup id="settings-updates" title="Updates" items={Object.values(UPDATE_SETTINGS_ITEMS)}>
      <SettingsToggleItem item={UPDATE_SETTINGS_ITEMS.automatic} checked={automatic}
        onChange={(autoCheckUpdates) => updateSettings({ autoCheckUpdates })} />
      <SettingsItem item={UPDATE_SETTINGS_ITEMS.delay}>
        <DropdownSelect ariaLabel={UPDATE_SETTINGS_ITEMS.delay.label} value={String(delay)} groups={groups}
          onChange={(value) => {
            const choice = delays.find(({ hours }) => String(hours) === value);
            if (choice) updateSettings({ updateDelayHours: choice.hours });
          }} />
      </SettingsItem>
      <SettingsItem item={UPDATE_SETTINGS_ITEMS.check}>
        <PressButton type="button" className="btn ghost" pressOnPointerDown={false}
          onClick={() => void useUpdateStore.getState().checkManually()}>
          Check now
        </PressButton>
      </SettingsItem>
    </SettingsGroup>
  );
};
