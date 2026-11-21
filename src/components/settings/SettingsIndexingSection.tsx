// Indexed-search settings stay user-facing here without exposing backend jargon.
import { useCallback, useEffect, useState } from "react";
import { shallow } from "zustand/shallow";
import { getIndexedSearchCatalogPath, openPath } from "@/api";
import { PressButton } from "@/components/primitives/PressButton";
import { useSettingsStore } from "@/modules";

type SettingsIndexingSectionProps = {
  sectionId: string;
  open: boolean;
};

export const SettingsIndexingSection = ({
  sectionId,
  open,
}: SettingsIndexingSectionProps) => {
  const { indexedSearchEnabled, updateSettings } = useSettingsStore(
    (state) => ({
      indexedSearchEnabled: state.indexedSearchEnabled,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const [catalogPath, setCatalogPath] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let canceled = false;

    void getIndexedSearchCatalogPath().catch(() => null).then((path) => {
      if (!canceled) setCatalogPath(path);
    });

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

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Indexing</div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Enable indexed search</div>
          <div className="settings-desc">
            Indexes files your Windows account can browse. On supported NTFS drives, the index
            catches up with changes made while Stratum was closed.
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
