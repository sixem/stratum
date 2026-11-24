// Playback preferences and the FFmpeg executable used for media tools.
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton } from "@/components/primitives/PressButton";
import { usePromptStore, useSettingsStore, useShellStore } from "@/modules";
import { SettingsItem, type SettingsItemText } from "./SettingsItem";

export const MEDIA_SETTINGS_ITEMS = {
  galleryAudio: {
    label: "Audio in gallery",
    description: "Include supported audio files in Quick Preview and Gallery.",
    keywords: "music playback mp3 wav flac",
  },
  videoAutoplay: {
    label: "Autoplay videos",
    description: "Start videos automatically when opening them in Quick Preview or Gallery.",
    keywords: "playback open paused",
  },
  ffmpeg: {
    label: "FFmpeg",
    description: "Choose the executable used for media conversion.",
    keywords: "locate automatic path ffmpeg.exe",
  },
} satisfies Record<string, SettingsItemText>;

export const SettingsMediaSection = ({ sectionId }: { sectionId: string }) => {
  const galleryAudio = useSettingsStore((state) => state.galleryAudio);
  const videoAutoplay = useSettingsStore((state) => state.videoAutoplay);
  const ffmpegPath = useSettingsStore((state) => state.ffmpegPath);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const shellAvailability = useShellStore((state) => state.availability);
  const ffmpegStatus = !shellAvailability ? "Checking…" : !shellAvailability.ffmpeg
    ? "Unavailable" : shellAvailability.ffmpegMessage ? "Using automatic" : "Available";
  const statusClass = shellAvailability ? (shellAvailability.ffmpeg ? "is-ok" : "is-missing") : "";
  const ffmpegDetails = shellAvailability?.ffmpegMessage || shellAvailability?.ffmpegPath;

  const showLocatePrompt = () => {
    let pendingPath = ffmpegPath;
    const savePath = () => updateSettings({ ffmpegPath: pendingPath.trim() });

    usePromptStore.getState().showPrompt({
      title: "Locate FFmpeg",
      content: (
        <div className="prompt-field">
          <span className="prompt-label">FFmpeg path</span>
          <input
            className="prompt-input"
            type="text"
            aria-label="FFmpeg path"
            placeholder="C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe"
            defaultValue={ffmpegPath}
            autoFocus
            onChange={(event) => { pendingPath = event.currentTarget.value; }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              savePath();
              usePromptStore.getState().hidePrompt();
            }}
          />
        </div>
      ),
      confirmLabel: "Save",
      cancelLabel: "Cancel",
      onConfirm: savePath,
    });
  };

  const locateFfmpeg = async () => {
    if ("__TAURI_INTERNALS__" in globalThis || "__TAURI__" in globalThis) {
      try {
        const selection = await openDialog({
          multiple: false,
          directory: false,
          title: "Locate FFmpeg",
          filters: [{ name: "Executable", extensions: ["exe"] }],
          defaultPath: shellAvailability?.ffmpegPath || undefined,
        });
        if (typeof selection === "string" && selection.trim()) {
          updateSettings({ ffmpegPath: selection.trim() });
        }
        return;
      } catch {
        // Keep path entry available if the system picker fails.
      }
    }
    showLocatePrompt();
  };

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Media</div>
      <SettingsItem item={MEDIA_SETTINGS_ITEMS.galleryAudio}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={MEDIA_SETTINGS_ITEMS.galleryAudio.label}
            checked={galleryAudio}
            onChange={(event) => updateSettings({ galleryAudio: event.currentTarget.checked })}
          />
          <span aria-hidden="true" />
        </label>
      </SettingsItem>
      <SettingsItem item={MEDIA_SETTINGS_ITEMS.videoAutoplay}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={MEDIA_SETTINGS_ITEMS.videoAutoplay.label}
            checked={videoAutoplay}
            onChange={(event) => updateSettings({ videoAutoplay: event.currentTarget.checked })}
          />
          <span aria-hidden="true" />
        </label>
      </SettingsItem>
      <SettingsItem
        item={MEDIA_SETTINGS_ITEMS.ffmpeg}
        details={(
          <TooltipWrapper text={ffmpegDetails ?? ""}>
            <span className={`settings-media-status ${statusClass}`}>{ffmpegStatus}</span>
          </TooltipWrapper>
        )}
      >
        <div className="settings-actions">
          <PressButton type="button" className="btn ghost" onClick={locateFfmpeg}>
            Locate FFmpeg
          </PressButton>
          {ffmpegPath && (
            <PressButton type="button" className="btn ghost" onClick={() => updateSettings({ ffmpegPath: "" })}>
              Use automatic
            </PressButton>
          )}
        </div>
      </SettingsItem>
    </section>
  );
};
