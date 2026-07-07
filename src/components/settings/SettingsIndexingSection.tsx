// Indexed-search settings stay user-facing here without exposing backend jargon.
import { useCallback, useEffect, useState } from "react";
import { shallow } from "zustand/shallow";
import type { PromptConfig } from "@/modules";
import type { IndexingRuntimeMode } from "@/types";
import { getIndexedSearchCatalogPath, openPath, setIndexingLaunchPreferences } from "@/api";
import { readIndexingRuntimeMode, requestAcceleratedIndexingRelaunch } from "@/lib";
import { PressButton } from "@/components/primitives/PressButton";
import { usePromptStore, useSettingsStore } from "@/modules";

type SettingsIndexingSectionProps = {
  sectionId: string;
  open: boolean;
};

const MODE_LABELS: Record<IndexingRuntimeMode, string> = {
  normal: "Normal",
  accelerated: "Accelerated",
};
const isDevLaunchSession = import.meta.env.MODE === "development";

export const SettingsIndexingSection = ({
  sectionId,
  open,
}: SettingsIndexingSectionProps) => {
  const showPrompt = usePromptStore((state) => state.showPrompt);
  const { indexedSearchEnabled, acceleratedNtfsIndexing, updateSettings } = useSettingsStore(
    (state) => ({
      indexedSearchEnabled: state.indexedSearchEnabled,
      acceleratedNtfsIndexing: state.acceleratedNtfsIndexing,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const [runtimeMode, setRuntimeMode] = useState<IndexingRuntimeMode>("normal");
  const [modeLoaded, setModeLoaded] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [catalogPath, setCatalogPath] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let canceled = false;

    const loadIndexingDetails = async () => {
      try {
        const [nextMode, nextCatalogPath] = await Promise.all([
          readIndexingRuntimeMode(),
          getIndexedSearchCatalogPath().catch(() => null),
        ]);
        if (canceled) return;
        setRuntimeMode(nextMode);
        setCatalogPath(nextCatalogPath);
      } finally {
        if (!canceled) {
          setModeLoaded(true);
        }
      }
    };

    setModeLoaded(false);
    void loadIndexingDetails();

    return () => {
      canceled = true;
    };
  }, [open]);

  const handleRevealCatalogDirectory = useCallback(async () => {
    if (!catalogPath || catalogBusy) return;
    const separatorIndex = Math.max(catalogPath.lastIndexOf("\\"), catalogPath.lastIndexOf("/"));
    const directoryPath =
      separatorIndex >= 0 ? catalogPath.slice(0, separatorIndex) : catalogPath;

    setCatalogBusy(true);
    try {
      await openPath(directoryPath);
    } finally {
      setCatalogBusy(false);
    }
  }, [catalogBusy, catalogPath]);

  const handleRequestAcceleratedLaunch = useCallback(async () => {
    if (restartBusy) return;
    setRestartBusy(true);
    const result = await requestAcceleratedIndexingRelaunch({ showPrompt });
    if (result !== "launched") {
      updateSettings({ acceleratedNtfsIndexing: false });
      await setIndexingLaunchPreferences({
        indexedSearchEnabled,
        acceleratedNtfsIndexing: false,
      });
      setRestartBusy(false);
    }
  }, [indexedSearchEnabled, restartBusy, showPrompt, updateSettings]);

  const handleAcceleratedToggle = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        updateSettings({ acceleratedNtfsIndexing: false });
        void setIndexingLaunchPreferences({
          indexedSearchEnabled,
          acceleratedNtfsIndexing: false,
        });
        return;
      }

      const nextRuntimeMode: IndexingRuntimeMode = modeLoaded
        ? runtimeMode
        : await readIndexingRuntimeMode();
      setRuntimeMode(nextRuntimeMode);
      setModeLoaded(true);

      if (nextRuntimeMode === "accelerated") {
        updateSettings({ acceleratedNtfsIndexing: true });
        void setIndexingLaunchPreferences({
          indexedSearchEnabled,
          acceleratedNtfsIndexing: true,
        });
        return;
      }

      if (isDevLaunchSession) {
        updateSettings({ acceleratedNtfsIndexing: true });
        showPrompt({
          title: "Accelerated indexing saved",
          content:
            "Administrator relaunch is disabled during tauri dev so the dev runner stays attached. Test accelerated NTFS indexing from a built app.",
          confirmLabel: "Close",
          cancelLabel: null,
        });
        return;
      }

      const prompt: PromptConfig = {
        title: "Restart with administrator approval?",
        content:
          "Accelerated NTFS indexing needs an elevated restart. Windows will ask for administrator approval next.",
        confirmLabel: "Restart elevated",
        cancelLabel: "Cancel",
        onConfirm: () => {
          updateSettings({ acceleratedNtfsIndexing: true });
          void setIndexingLaunchPreferences({
            indexedSearchEnabled,
            acceleratedNtfsIndexing: true,
          });
          void handleRequestAcceleratedLaunch();
        },
      };
      showPrompt(prompt);
    },
    [
      handleRequestAcceleratedLaunch,
      modeLoaded,
      runtimeMode,
      showPrompt,
      updateSettings,
    ],
  );

  const currentModeLabel = modeLoaded ? MODE_LABELS[runtimeMode] : "Checking";
  const currentModeDisplayLabel = indexedSearchEnabled ? currentModeLabel : "Disabled";
  const modeDescription =
    !indexedSearchEnabled
      ? "Indexed search is off."
      : runtimeMode === "accelerated"
      ? "Accelerated NTFS indexing is active."
      : acceleratedNtfsIndexing
        ? "Accelerated NTFS indexing is enabled and will request administrator approval when needed."
        : "Normal indexing is active.";

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Indexing</div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Enable indexed search</div>
          <div className="settings-desc">
            Turns on indexed search and background indexing.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={indexedSearchEnabled}
            onChange={(event) => {
              updateSettings({ indexedSearchEnabled: event.currentTarget.checked });
            }}
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label settings-label-row">
            <span>Current mode</span>
            <span className="settings-chip">{currentModeDisplayLabel}</span>
          </div>
          <div className="settings-desc">{modeDescription}</div>
        </div>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">
            Use accelerated NTFS indexing (requires administrator approval)
          </div>
          <div className="settings-desc">
            Uses administrator-approved NTFS indexing when available.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={acceleratedNtfsIndexing}
            disabled={!indexedSearchEnabled || restartBusy}
            onChange={(event) => {
              void handleAcceleratedToggle(event.currentTarget.checked);
            }}
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Index database</div>
          <div className="settings-desc">
            Stored in the app data directory.
          </div>
          <div className="settings-mono">{catalogPath ?? "Unavailable"}</div>
        </div>
        <div className="settings-actions">
          <PressButton
            type="button"
            className="btn ghost"
            disabled={!catalogPath || catalogBusy}
            onClick={handleRevealCatalogDirectory}
          >
            Reveal in Explorer
          </PressButton>
        </div>
      </div>
    </section>
  );
};
