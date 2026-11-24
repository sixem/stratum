// Context menu customization settings.
import { useId } from "react";
import { shallow } from "zustand/shallow";
import { RECENT_MOVE_LIMIT_MAX, RECENT_MOVE_LIMIT_MIN } from "@/constants";
import { useSettingsStore } from "@/modules";

import { SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";
import { SettingsMenuVisibility } from "./SettingsMenuVisibility";
import { useDeferredRange } from "./useDeferredRange";

export const MENUS_SETTINGS_ITEMS = {
  windowsItemMenu: {
    label: "Use Windows context menu for items",
    description: "Open the menu from Show more options directly for files and folders.",
    keywords: "native shell right click disable built-in custom context menu",
  },
  paneTransfers: {
    label: "Transfers between panes",
    description: "Show Copy and Move to the folder open in the other pane.",
    keywords: "split dual pane copy move destination",
  },
  openBackgroundTab: {
    label: "Open in background tab",
    description: "Show a folder menu action that opens a new tab without switching to it.",
    keywords: "open folder unfocused inactive tab",
  },
  selectionActions: {
    label: "Selection actions",
    description: "Show Select by extension and Invert selection for the visible files and folders.",
    keywords: "select same type file extension invert filter",
  },
  conversionActions: {
    label: "Conversion actions",
    description: "Show convert and quick-convert actions in file context menus.",
  },
  rememberMoveDestinations: {
    label: "Remember move destinations",
    description: "Show recent destinations in the Move to menu. Tabs and panes in the same workspace share the list.",
    keywords: "recent moves history limit maximum",
  },
  recentMoveLimit: {
    label: "Recent move limit",
    description: "Keep up to this many destinations per workspace. Older destinations are removed first.",
    keywords: "Move to history",
    requiresMoveHistory: true,
  },
  backgroundActions: {
    label: "Background actions",
    description: "Show quick shell launchers when right-clicking the view background.",
    keywords: "PowerShell WSL",
  },
} satisfies Record<string, SettingsItemText>;

type SettingsMenusSectionProps = {
  sectionId: string;
};

export const SettingsMenusSection = ({ sectionId }: SettingsMenusSectionProps) => {
  const windowsMenuDescriptionId = useId();
  const {
    menuUseWindowsForItems, menuOpenPwsh, menuOpenWsl, menuShowConvert, menuPaneTransfers,
    menuSelectionActions, menuOpenBackgroundTab,
    rememberMoveDestinations, recentMoveLimit, updateSettings,
  } = useSettingsStore(
    (state) => ({
      menuUseWindowsForItems: state.menuUseWindowsForItems,
      menuOpenPwsh: state.menuOpenPwsh,
      menuOpenWsl: state.menuOpenWsl,
      menuShowConvert: state.menuShowConvert,
      menuPaneTransfers: state.menuPaneTransfers,
      menuSelectionActions: state.menuSelectionActions,
      menuOpenBackgroundTab: state.menuOpenBackgroundTab,
      rememberMoveDestinations: state.rememberMoveDestinations,
      recentMoveLimit: state.recentMoveLimit,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const limit = useDeferredRange({
    value: recentMoveLimit,
    onCommit: (value) => updateSettings({ recentMoveLimit: value }),
  });

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Context menus</div>
      <SettingsItem item={MENUS_SETTINGS_ITEMS.windowsItemMenu} descriptionId={windowsMenuDescriptionId}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={MENUS_SETTINGS_ITEMS.windowsItemMenu.label}
            aria-describedby={windowsMenuDescriptionId}
            checked={menuUseWindowsForItems}
            onChange={(event) => updateSettings({ menuUseWindowsForItems: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={MENUS_SETTINGS_ITEMS.openBackgroundTab}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={MENUS_SETTINGS_ITEMS.openBackgroundTab.label}
            checked={menuOpenBackgroundTab}
            onChange={(event) => updateSettings({ menuOpenBackgroundTab: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={MENUS_SETTINGS_ITEMS.paneTransfers}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={MENUS_SETTINGS_ITEMS.paneTransfers.label}
            checked={menuPaneTransfers}
            onChange={(event) => updateSettings({ menuPaneTransfers: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={MENUS_SETTINGS_ITEMS.selectionActions}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={MENUS_SETTINGS_ITEMS.selectionActions.label}
            checked={menuSelectionActions}
            onChange={(event) => updateSettings({ menuSelectionActions: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={MENUS_SETTINGS_ITEMS.conversionActions}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={menuShowConvert}
            onChange={(event) =>
              updateSettings({ menuShowConvert: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={MENUS_SETTINGS_ITEMS.rememberMoveDestinations}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={MENUS_SETTINGS_ITEMS.rememberMoveDestinations.label}
            checked={rememberMoveDestinations}
            onChange={(event) => updateSettings({ rememberMoveDestinations: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      {rememberMoveDestinations && (
        <SettingsItem item={MENUS_SETTINGS_ITEMS.recentMoveLimit}>
          <div className="settings-range">
            <input
              type="range"
              className="ui-range"
              aria-label={MENUS_SETTINGS_ITEMS.recentMoveLimit.label}
              min={RECENT_MOVE_LIMIT_MIN}
              max={RECENT_MOVE_LIMIT_MAX}
              step={1}
              {...limit.bind}
            />
            <span className="settings-value tnum">{limit.draft}</span>
          </div>
        </SettingsItem>
      )}
      <SettingsItem item={MENUS_SETTINGS_ITEMS.backgroundActions}>
        <div className="settings-pills" role="group" aria-label="Background menu">
          <label
            className={`settings-pill settings-pill-check${
              menuOpenPwsh ? " is-active" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={menuOpenPwsh}
              onChange={(event) =>
                updateSettings({ menuOpenPwsh: event.currentTarget.checked })
              }
            />
            <span>Open in PowerShell</span>
          </label>
          <label
            className={`settings-pill settings-pill-check${
              menuOpenWsl ? " is-active" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={menuOpenWsl}
              onChange={(event) =>
                updateSettings({ menuOpenWsl: event.currentTarget.checked })
              }
            />
            <span>Open in WSL</span>
          </label>
        </div>
      </SettingsItem>
      <SettingsMenuVisibility />
    </section>
  );
};
