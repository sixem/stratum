// Header, navigation bar, and sidebar presentation controls.
import { shallow } from "zustand/shallow";
import type { SidebarSectionId } from "@/modules";
import {
  SIDEBAR_RECENT_LIMIT_MAX,
  SIDEBAR_RECENT_LIMIT_MIN,
  SIDEBAR_SECTION_DEFINITIONS,
  normalizeSidebarHiddenSections,
  normalizeSidebarSectionOrder,
  useSettingsStore,
} from "@/modules";
import { EyeIcon, EyeOffIcon } from "@/components";
import { PressButton } from "@/components/primitives/PressButton";
import { useDeferredRange } from "./useDeferredRange";

import { SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const BARS_SETTINGS_ITEMS = {
  tabNumbers: {
    label: "Tab numbers",
    description: "Show a small index number beside each tab title.",
  },
  fixedWidthTabs: {
    label: "Fixed-width tabs",
    description: "Keep every tab the same width instead of sizing to the title.",
  },
  tabDropSubfolders: {
    label: "Tab drop subfolders",
    description: "When dragging onto a tab, reveal its direct subfolders as extra drop targets.",
  },
  recentJumps: {
    label: "Recent jumps window",
    description: "Control how many locations stay in the rolling list.",
    keywords: "recent folders sidebar history",
  },
  sidebarOrder: {
    label: "Sidebar order",
    description: "Reorder sections or toggle visibility to match your flow.",
    keywords: "sidebar visibility reorder hide show",
  },
} satisfies Record<string, SettingsItemText>;

type SettingsBarsSectionProps = {
  sectionId: string;
};

const RECENT_STEP = 1;
export const TOPBAR_SETTINGS_OPTIONS = [
  {
    key: "showRecycleBinButton",
    label: "Topbar Recycle Bin button",
    description: "Show a shortcut for opening the Windows Recycle Bin.",
  },
  {
    key: "showDriveToggle",
    label: "Topbar drive toggle",
    description: "Show the drive picker in the topbar.",
  },
  {
    key: "collapseDrivePickerOnBlur",
    label: "Collapse drive picker on focus loss",
    description: "Close the expanded drive list when you click or move focus outside it.",
    keywords: "drives topbar unfocus",
  },
  {
    key: "showTopbarFolderChevrons",
    label: "Topbar up/down chevrons",
    description: "Show the folder-level navigation buttons next to Back and Forward.",
  },
  {
    key: "showWorkProgressFill",
    label: "Work button progress",
    description: "Show job progress as a background fill on the Work button.",
    keywords: "topbar transfer copy move conversion animation",
  },
] as const;

export const SettingsBarsSection = ({
  sectionId,
}: SettingsBarsSectionProps) => {
  const settings = useSettingsStore(
    (state) => ({
      showTabNumbers: state.showTabNumbers,
      fixedWidthTabs: state.fixedWidthTabs,
      tabDropSubfolders: state.tabDropSubfolders,
      showRecycleBinButton: state.showRecycleBinButton,
      showDriveToggle: state.showDriveToggle,
      collapseDrivePickerOnBlur: state.collapseDrivePickerOnBlur,
      showTopbarFolderChevrons: state.showTopbarFolderChevrons,
      showWorkProgressFill: state.showWorkProgressFill,
      sidebarRecentLimit: state.sidebarRecentLimit,
      sidebarSectionOrder: state.sidebarSectionOrder,
      sidebarHiddenSections: state.sidebarHiddenSections,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const {
    showTabNumbers, fixedWidthTabs, tabDropSubfolders, sidebarRecentLimit,
    sidebarSectionOrder, sidebarHiddenSections, updateSettings,
  } = settings;
  const normalizedSidebarOrder = normalizeSidebarSectionOrder(sidebarSectionOrder);
  const normalizedHiddenSections = normalizeSidebarHiddenSections(sidebarHiddenSections);
  const hiddenSet = new Set(normalizedHiddenSections);
  const recentRange = useDeferredRange({
    value: sidebarRecentLimit,
    onCommit: (value) => updateSettings({ sidebarRecentLimit: value }),
  });
  const buildHiddenList = (nextHidden: Set<SidebarSectionId>) =>
    SIDEBAR_SECTION_DEFINITIONS.filter((item) => nextHidden.has(item.id)).map(
      (item) => item.id,
    );
  const handleMoveSidebarSection = (id: SidebarSectionId, direction: -1 | 1) => {
    const order = normalizeSidebarSectionOrder(sidebarSectionOrder);
    const index = order.indexOf(id);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    updateSettings({ sidebarSectionOrder: next });
  };
  const handleToggleSection = (id: SidebarSectionId) => {
    const nextHidden = new Set(hiddenSet);
    if (nextHidden.has(id)) {
      nextHidden.delete(id);
    } else {
      nextHidden.add(id);
    }
    updateSettings({ sidebarHiddenSections: buildHiddenList(nextHidden) });
  };

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Tabs &amp; bars</div>
      <SettingsItem item={BARS_SETTINGS_ITEMS.tabNumbers}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={showTabNumbers}
            onChange={(event) =>
              updateSettings({ showTabNumbers: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={BARS_SETTINGS_ITEMS.fixedWidthTabs}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={fixedWidthTabs}
            onChange={(event) =>
              updateSettings({ fixedWidthTabs: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={BARS_SETTINGS_ITEMS.tabDropSubfolders}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={tabDropSubfolders}
            onChange={(event) =>
              updateSettings({ tabDropSubfolders: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      {TOPBAR_SETTINGS_OPTIONS.map((option) => {
        const { key } = option;
        return (
          <SettingsItem item={option} key={key}>
            <label className="settings-toggle">
              <input
                type="checkbox"
                aria-label={option.label}
                checked={settings[key]}
                onChange={(event) => updateSettings({ [key]: event.currentTarget.checked })}
              />
              <span />
            </label>
          </SettingsItem>
        );
      })}
      <div className="settings-section-title">Sidebar</div>
      <SettingsItem item={BARS_SETTINGS_ITEMS.recentJumps}>
        <div className="settings-range">
          <input
            type="range"
            className="ui-range"
            min={SIDEBAR_RECENT_LIMIT_MIN}
            max={SIDEBAR_RECENT_LIMIT_MAX}
            step={RECENT_STEP}
            {...recentRange.bind}
          />
          <span className="settings-value">{recentRange.draft}</span>
        </div>
      </SettingsItem>
      <SettingsItem item={BARS_SETTINGS_ITEMS.sidebarOrder} className="is-stacked">
        <div className="settings-order">
          {normalizedSidebarOrder.map((sectionIdValue, index) => {
            const section = SIDEBAR_SECTION_DEFINITIONS.find(
              (item) => item.id === sectionIdValue,
            );
            const isHidden = hiddenSet.has(sectionIdValue);
            return (
              <div
                className={`settings-order-item${isHidden ? " is-hidden" : ""}`}
                key={sectionIdValue}
              >
                <span className="settings-order-label">
                  {section?.label ?? sectionIdValue}
                </span>
                <div className="settings-order-actions">
                  <PressButton
                    type="button"
                    className={`settings-order-visibility${
                      isHidden ? " is-hidden" : ""
                    }`}
                    onClick={() => handleToggleSection(sectionIdValue)}
                    aria-label={`${
                      isHidden ? "Show" : "Hide"
                    } ${section?.label ?? sectionIdValue} section`}
                  >
                    {isHidden ? (
                      <EyeOffIcon className="settings-order-icon" />
                    ) : (
                      <EyeIcon className="settings-order-icon" />
                    )}
                  </PressButton>
                  <PressButton
                    type="button"
                    className="btn ghost"
                    disabled={index === 0}
                    onClick={() => handleMoveSidebarSection(sectionIdValue, -1)}
                    aria-label={`Move ${section?.label ?? sectionIdValue} up`}
                  >
                    Up
                  </PressButton>
                  <PressButton
                    type="button"
                    className="btn ghost"
                    disabled={index === normalizedSidebarOrder.length - 1}
                    onClick={() => handleMoveSidebarSection(sectionIdValue, 1)}
                    aria-label={`Move ${section?.label ?? sectionIdValue} down`}
                  >
                    Down
                  </PressButton>
                </div>
              </div>
            );
          })}
        </div>
      </SettingsItem>
    </section>
  );
};
