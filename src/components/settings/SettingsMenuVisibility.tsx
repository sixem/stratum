// Group menu visibility controls so each action can be changed independently.
import { SettingsPills } from "./SettingsPills";
import { CONTEXT_MENU_ACTION_GROUPS, type ContextMenuAction } from "@/lib/contextMenuVisibility";
import { useSettingsStore } from "@/modules";
import { SettingsItem } from "./SettingsItem";

const groups = CONTEXT_MENU_ACTION_GROUPS.map((group) => ({
  actions: group.actions,
  item: {
    label: group.label,
    description: group.description,
    keywords: [...group.actions.map(({ label }) => label), "keywords" in group ? group.keywords : ""].join(" "),
  },
}));

export const MENU_VISIBILITY_SETTINGS_ITEMS = groups.map(({ item }) => item);

export function SettingsMenuVisibility() {
  const hidden = useSettingsStore((state) => state.hiddenContextMenuActions);
  const setVisible = (id: ContextMenuAction, visible: boolean) => {
    const { hiddenContextMenuActions, updateSettings } = useSettingsStore.getState();
    updateSettings({
      hiddenContextMenuActions: visible
        ? hiddenContextMenuActions.filter((action) => action !== id)
        : [...hiddenContextMenuActions, id],
    });
  };

  return groups.map(({ item, actions }) => (
    <SettingsItem key={item.label} item={item} className="is-stacked">
      <SettingsPills aria-label={item.label}>
        {actions.map(({ id, label }) => {
          const visible = !hidden.includes(id);
          return (
            <label className={`settings-pill settings-pill-check${visible ? " is-active" : ""}`} key={id}>
              <input type="checkbox" checked={visible} onChange={(event) => setVisible(id, event.currentTarget.checked)} />
              <span>{label}</span>
            </label>
          );
        })}
      </SettingsPills>
    </SettingsItem>
  ));
}
