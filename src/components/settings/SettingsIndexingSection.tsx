// Indexed-search settings stay user-facing here without exposing backend jargon.
import { useCallback, useContext, useEffect, useState } from "react";
import { shallow } from "zustand/shallow";
import { getIndexedSearchCatalogPath, openPath } from "@/api";
import { PressButton } from "@/components/primitives/PressButton";
import { useSettingsStore } from "@/modules";

import { SettingsItem, SettingsSearchMatches } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const INDEXING_SETTINGS_ITEMS = {
  enable: {
    label: "Enable indexed search",
    description: "Indexes files your Windows account can browse. On supported NTFS drives, the index catches up with changes made while Stratum was closed.",
  },
  database: {
    label: "Index database",
    description: "Stored in the app data directory.",
    keywords: "catalog location reveal in Explorer",
  },
} satisfies Record<string, SettingsItemText>;

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
  const matches = useContext(SettingsSearchMatches);
  const showCatalogPath = !matches || matches.has(INDEXING_SETTINGS_ITEMS.database);

  useEffect(() => {
    if (!open || !showCatalogPath) return;
    let canceled = false;

    void getIndexedSearchCatalogPath().catch(() => null).then((path) => {
      if (!canceled) setCatalogPath(path);
    });

    return () => {
      canceled = true;
    };
  }, [open, showCatalogPath]);

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
      <SettingsItem item={INDEXING_SETTINGS_ITEMS.enable}>
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
      </SettingsItem>
      <SettingsItem
        item={INDEXING_SETTINGS_ITEMS.database}
        details={<div className="settings-mono">{catalogPath ?? "Unavailable"}</div>}
      >
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
      </SettingsItem>
    </section>
  );
};
