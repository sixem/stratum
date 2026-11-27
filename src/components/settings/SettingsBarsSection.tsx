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

import { SettingsGroup, SettingsItem, SettingsToggleItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

const TAB_SETTINGS_ITEMS = {
  tabNumbers: {
    label: "Tab numbers",
    description: "Show a small index number beside each tab title.",
  },
  fixedWidthTabs: {
    label: "Fixed-width tabs",
    description: "Keep every tab the same width instead of sizing to the title.",
  },
  animateTabChanges: {
    label: "Animate tab changes",
    description: "Gently reveal the selected tab’s contents in either pane.",
    keywords: "animation transition motion fade",
  },
  wrapTabNavigation: {
    label: "Wrap tab navigation",
    description: "Go from the first tab to the last, and from the last tab to the first, with tab shortcuts in either pane.",
    keywords: "wrap around cycle previous next left right ctrl tab keyboard",
  },
  tabDropSubfolders: {
    label: "Tab drop subfolders",
    description: "When dragging onto a tab, reveal its direct subfolders as extra drop targets.",
  },
  tabDropParentFolder: {
    label: "Tab drop parent folder",
    description: "Show the parent folder at the top of the tab drop menu.",
  },
} satisfies Record<string, SettingsItemText>;

const SIDEBAR_SETTINGS_ITEMS = {
  recentJumps: {
    label: "Recent jumps limit",
    description: "Control how many locations stay in the rolling list.",
    keywords: "recent folders sidebar history",
  },
  sidebarOrder: {
    label: "Sidebar sections",
    description: "Reorder or show and hide Places, Recent jumps, and Tips.",
    keywords: "sidebar visibility reorder hide show disable tips hints",
  },
} satisfies Record<string, SettingsItemText>;

type SettingsBarsSectionProps = {
  sectionId: string;
};

const RECENT_STEP = 1;
const TOPBAR_SETTINGS_OPTIONS = [
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
    key: "fullWidthBreadcrumbs",
    label: "Full-width breadcrumb bar",
    description: "Extend the breadcrumb bar above the sidebar.",
    keywords: "path crumbs sidebar layout width",
  },
  {
    key: "showWorkProgressFill",
    label: "Work button progress",
    description: "Show job progress as a background fill on the Work button.",
    keywords: "topbar transfer copy move conversion animation",
  },
] as const;

export const BARS_SETTINGS_ITEMS = [
  ...Object.values(TAB_SETTINGS_ITEMS),
  ...TOPBAR_SETTINGS_OPTIONS,
  ...Object.values(SIDEBAR_SETTINGS_ITEMS),
];

export const SettingsBarsSection = ({
  sectionId,
}: SettingsBarsSectionProps) => {
  const settings = useSettingsStore(
    (state) => ({
      showTabNumbers: state.showTabNumbers,
      fixedWidthTabs: state.fixedWidthTabs,
      animateTabChanges: state.animateTabChanges,
      wrapTabNavigation: state.wrapTabNavigation,
      tabDropSubfolders: state.tabDropSubfolders,
      tabDropParentFolder: state.tabDropParentFolder,
      showRecycleBinButton: state.showRecycleBinButton,
      showDriveToggle: state.showDriveToggle,
      collapseDrivePickerOnBlur: state.collapseDrivePickerOnBlur,
      showTopbarFolderChevrons: state.showTopbarFolderChevrons,
      fullWidthBreadcrumbs: state.fullWidthBreadcrumbs,
      showWorkProgressFill: state.showWorkProgressFill,
      sidebarRecentLimit: state.sidebarRecentLimit,
      sidebarSectionOrder: state.sidebarSectionOrder,
      sidebarHiddenSections: state.sidebarHiddenSections,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const {
    showTabNumbers, fixedWidthTabs, animateTabChanges, wrapTabNavigation, tabDropSubfolders, sidebarRecentLimit,
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
    <>
      <SettingsGroup id={sectionId} title="Tabs" items={Object.values(TAB_SETTINGS_ITEMS)}>
        <SettingsToggleItem item={TAB_SETTINGS_ITEMS.tabNumbers} checked={showTabNumbers}
          onChange={(checked) => updateSettings({ showTabNumbers: checked })} />
        <SettingsToggleItem item={TAB_SETTINGS_ITEMS.fixedWidthTabs} checked={fixedWidthTabs}
          onChange={(checked) => updateSettings({ fixedWidthTabs: checked })} />
        <SettingsToggleItem item={TAB_SETTINGS_ITEMS.animateTabChanges} checked={animateTabChanges}
          onChange={(checked) => updateSettings({ animateTabChanges: checked })} />
        <SettingsToggleItem item={TAB_SETTINGS_ITEMS.wrapTabNavigation} checked={wrapTabNavigation}
          onChange={(checked) => updateSettings({ wrapTabNavigation: checked })} />
        <SettingsToggleItem item={TAB_SETTINGS_ITEMS.tabDropSubfolders} checked={tabDropSubfolders}
          onChange={(checked) => updateSettings({ tabDropSubfolders: checked })} />
        <SettingsToggleItem item={TAB_SETTINGS_ITEMS.tabDropParentFolder} checked={settings.tabDropParentFolder}
          onChange={(checked) => updateSettings({ tabDropParentFolder: checked })} />
      </SettingsGroup>
      <SettingsGroup id={`${sectionId}-topbar`} title="Top bar" items={TOPBAR_SETTINGS_OPTIONS}>
        {TOPBAR_SETTINGS_OPTIONS.map((option) => (
          <SettingsToggleItem key={option.key} item={option} checked={settings[option.key]}
            onChange={(checked) => updateSettings({ [option.key]: checked })} />
        ))}
      </SettingsGroup>
      <SettingsGroup id={`${sectionId}-sidebar`} title="Sidebar" items={Object.values(SIDEBAR_SETTINGS_ITEMS)}>
        <SettingsItem item={SIDEBAR_SETTINGS_ITEMS.recentJumps}>
          <div className="settings-range">
            <input
              type="range"
              aria-label={SIDEBAR_SETTINGS_ITEMS.recentJumps.label}
              className="ui-range"
              min={SIDEBAR_RECENT_LIMIT_MIN}
              max={SIDEBAR_RECENT_LIMIT_MAX}
              step={RECENT_STEP}
              {...recentRange.bind}
            />
            <span className="settings-value">{recentRange.draft}</span>
          </div>
        </SettingsItem>
        <SettingsItem item={SIDEBAR_SETTINGS_ITEMS.sidebarOrder} className="is-stacked">
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
      </SettingsGroup>
    </>
  );
};
