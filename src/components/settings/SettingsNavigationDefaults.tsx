// Startup, new-tab sorting, and recent-location preferences for both panes.
import { useMemo } from "react";
import { shallow } from "zustand/shallow";
import { DropdownSelect } from "@/components/primitives/DropdownSelect";
import { PressButton } from "@/components/primitives/PressButton";
import { toMessage } from "@/lib";
import { usePromptStore } from "@/modules";
import { useSettingsStore } from "@/modules/settings.store";
import type { StartupMode } from "@/modules/settings.types";
import { clearRecentLocations, useWorkspaceStore } from "@/modules/workspaceStore";
import type { SortState } from "@/types";
import { SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const NAVIGATION_SETTINGS_ITEMS = {
  startup: {
    label: "When Stratum starts",
    description: "Resume your tabs, open a workspace, or start browsing.",
    keywords: "startup launch restore reopen session saved workspace",
  },
  sort: {
    label: "Sort for new tabs",
    description: "Inherit the current tab’s sort or choose a default for both panes.",
  },
  recentLocations: {
    label: "Remember recent locations",
    description: "Record and show recently visited folders.",
    keywords: "history recent jumps clear privacy",
  },
} satisfies Record<string, SettingsItemText>;

const STARTUP_OPTIONS: { value: StartupMode; label: string }[] = [
  { value: "resume", label: "Resume last session" },
  { value: "workspace", label: "Open a workspace" },
  { value: "start", label: "Start browsing" },
];
const STARTUP_GROUPS = [{ id: "startup", options: STARTUP_OPTIONS }];

const SORT_OPTIONS: { value: string; label: string; sort: SortState | null }[] = [
  { value: "inherit", label: "Inherit current tab", sort: null },
  { value: "name-asc", label: "Name, A–Z", sort: { key: "name", dir: "asc" } },
  { value: "name-desc", label: "Name, Z–A", sort: { key: "name", dir: "desc" } },
  { value: "modified-desc", label: "Modified, newest first", sort: { key: "modified", dir: "desc" } },
  { value: "modified-asc", label: "Modified, oldest first", sort: { key: "modified", dir: "asc" } },
  { value: "size-desc", label: "Size, largest first", sort: { key: "size", dir: "desc" } },
  { value: "size-asc", label: "Size, smallest first", sort: { key: "size", dir: "asc" } },
];
const SORT_GROUPS = [{ id: "new-tab-sort", options: SORT_OPTIONS }];

const confirmClearRecentLocations = () => {
  usePromptStore.getState().showPrompt({
    title: "Clear recent locations?",
    content: "Clear visited folders from both panes and saved workspaces. Your tabs and pinned places will stay.",
    confirmLabel: "Clear history",
    cancelLabel: "Cancel",
    aboveOverlays: true,
    onConfirm: () => {
      try {
        clearRecentLocations();
      } catch (error) {
        usePromptStore.getState().showPrompt({
          title: "Couldn't clear recent locations",
          content: toMessage(error, "The saved history could not be updated."),
          aboveOverlays: true,
        });
      }
    },
  });
};

export const SettingsNavigationDefaults = () => {
  const { startupMode, startupWorkspaceId, newTabSort, rememberRecentLocations, updateSettings } = useSettingsStore(
    (state) => ({
      startupMode: state.startupMode,
      startupWorkspaceId: state.startupWorkspaceId,
      newTabSort: state.newTabSort,
      rememberRecentLocations: state.rememberRecentLocations,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const workspaceOptions = useMemo(() => [{
    id: "workspaces",
    options: workspaces.map(({ id, name }) => ({ value: id, label: name })),
  }], [workspaces]);
  const workspaceId = workspaces.some(({ id }) => id === startupWorkspaceId) ? startupWorkspaceId : null;

  return (
    <>
      <SettingsItem
        item={NAVIGATION_SETTINGS_ITEMS.startup}
        details={startupMode === "workspace" && !workspaceId && (
          <div className="settings-desc">Stratum resumes the last session until you select a workspace.</div>
        )}
      >
        <div className="settings-actions">
          <DropdownSelect
            ariaLabel={NAVIGATION_SETTINGS_ITEMS.startup.label}
            value={startupMode}
            groups={STARTUP_GROUPS}
            onChange={(value) => {
              const option = STARTUP_OPTIONS.find((item) => item.value === value);
              if (option) updateSettings({ startupMode: option.value });
            }}
          />
          {startupMode === "workspace" && (
            <DropdownSelect
              ariaLabel="Startup workspace"
              value={workspaceId}
              groups={workspaceOptions}
              placeholder={workspaces.length ? "Choose a workspace" : "No saved workspaces"}
              disabled={!workspaces.length}
              onChange={(value) => updateSettings({ startupWorkspaceId: value })}
            />
          )}
        </div>
      </SettingsItem>
      <SettingsItem item={NAVIGATION_SETTINGS_ITEMS.sort}>
        <DropdownSelect
          ariaLabel={NAVIGATION_SETTINGS_ITEMS.sort.label}
          value={newTabSort ? `${newTabSort.key}-${newTabSort.dir}` : "inherit"}
          groups={SORT_GROUPS}
          onChange={(value) => {
            const option = SORT_OPTIONS.find((item) => item.value === value);
            if (option) updateSettings({ newTabSort: option.sort });
          }}
        />
      </SettingsItem>
      <SettingsItem item={NAVIGATION_SETTINGS_ITEMS.recentLocations}>
        <div className="settings-actions">
          <PressButton type="button" className="btn ghost" onClick={confirmClearRecentLocations}>
            Clear history
          </PressButton>
          <label className="settings-toggle">
            <input
              type="checkbox"
              aria-label={NAVIGATION_SETTINGS_ITEMS.recentLocations.label}
              checked={rememberRecentLocations}
              onChange={(event) => updateSettings({ rememberRecentLocations: event.currentTarget.checked })}
            />
            <span aria-hidden="true" />
          </label>
        </div>
      </SettingsItem>
    </>
  );
};
