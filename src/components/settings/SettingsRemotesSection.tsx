// Network-backed folders have separate display preferences from local folders.
import { useSettingsStore } from "@/modules/settings.store";
import { SettingsGroup, SettingsToggleItem } from "./SettingsItem";

export const REMOTE_SETTINGS_ITEMS = {
  thumbnails: {
    label: "Show remote thumbnails",
    description: "Read small images over SFTP to display thumbnails in remote folders.",
  },
  videos: {
    label: "Show remote video thumbnails",
    description: "Read a small part of supported videos to show a frame.",
  },
  hidden: {
    label: "Show hidden remote entries",
    description: "Include files and folders whose names start with a dot.",
  },
};

export const SettingsRemotesSection = () => {
  const remoteThumbnails = useSettingsStore(state => state.remoteThumbnails);
  const remoteVideoThumbnails = useSettingsStore(state => state.remoteVideoThumbnails);
  const remoteShowHidden = useSettingsStore(state => state.remoteShowHidden);
  const updateSettings = useSettingsStore(state => state.updateSettings);
  return (
    <SettingsGroup id="settings-remotes" title="Remote folders" items={Object.values(REMOTE_SETTINGS_ITEMS)}>
      <SettingsToggleItem item={REMOTE_SETTINGS_ITEMS.thumbnails} checked={remoteThumbnails}
        onChange={enabled => updateSettings({ remoteThumbnails: enabled })} />
      <SettingsToggleItem item={REMOTE_SETTINGS_ITEMS.videos} checked={remoteVideoThumbnails}
        onChange={enabled => updateSettings({ remoteVideoThumbnails: enabled })} />
      <SettingsToggleItem item={REMOTE_SETTINGS_ITEMS.hidden} checked={remoteShowHidden}
        onChange={enabled => updateSettings({ remoteShowHidden: enabled })} />
    </SettingsGroup>
  );
};
