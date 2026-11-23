// Column options belong to the list header's existing folder menu.
import { useMemo } from "react";
import { LIST_COLUMN_OPTIONS } from "@/constants/settings";
import { useSettingsStore } from "@/modules";
import { DEFAULT_SETTINGS } from "@/modules/settings.defaults";
import type { ContextMenuItem } from "@/types";

export const useListColumnMenu = (enabled: boolean) => {
  const showSize = useSettingsStore((state) => enabled && state.listShowSize);
  const showModified = useSettingsStore((state) => enabled && state.listShowModified);

  return useMemo<ContextMenuItem | null>(() => {
    if (!enabled) return null;
    const values = { listShowSize: showSize, listShowModified: showModified };
    const defaults = {
      listShowSize: DEFAULT_SETTINGS.listShowSize,
      listShowModified: DEFAULT_SETTINGS.listShowModified,
    };
    return {
      kind: "submenu",
      id: "list-columns",
      label: "Columns",
      items: [
        ...LIST_COLUMN_OPTIONS.map(({ key, label }) => ({
          id: key,
          label,
          checked: values[key],
          onSelect: () => useSettingsStore.getState().updateSettings({ [key]: !values[key] }),
        })),
        { kind: "divider", id: "list-columns-divider" },
        {
          id: "list-columns-reset",
          label: "Reset columns",
          disabled: showSize === defaults.listShowSize && showModified === defaults.listShowModified,
          onSelect: () => useSettingsStore.getState().updateSettings(defaults),
        },
      ],
    };
  }, [enabled, showSize, showModified]);
};
