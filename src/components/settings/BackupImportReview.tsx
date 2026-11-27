// Review the workspace merge, portable settings, and path remaps before import.
import { SettingsPills } from "./SettingsPills";
import { useId, useMemo, useState } from "react";
import { PressButton } from "@/components/primitives/PressButton";
import { toMessage } from "@/lib";
import { listBackupLocations, remapBackupLocations } from "@/modules/backup/layoutPaths";
import type { BackupPathMapping } from "@/modules/backup/locations";
import { planBackupWorkspaceNames } from "@/modules/backup/mergeWorkspaces";
import type { BackupConflictPolicy } from "@/modules/backup/mergeWorkspaces";
import { applyStratumBackup, isUnusedBackupProfile } from "@/modules/backup/profile";
import type { StratumBackup } from "@/modules/backup/types";
import { useWorkspaceStore } from "@/modules/workspaceStore";
import { BackupPathReview } from "./BackupPathReview";
import { SettingsCheckbox } from "./SettingsCheckbox";

type Props = { backup: StratumBackup; onCancel: () => void; onImported: () => void };

const CONFLICT_OPTIONS = [
  { value: "copies", label: "Keep both" },
  { value: "replace", label: "Replace existing" },
] as const;

export const BackupImportReview = ({ backup, onCancel, onImported }: Props) => {
  const titleId = useId();
  const conflictLabelId = useId();
  const restoreDescriptionId = useId();
  const existing = useWorkspaceStore((state) => state.workspaces);
  const full = backup.scope === "full";
  const [fresh] = useState(() => full && isUnusedBackupProfile());
  const [conflicts, setConflicts] = useState<BackupConflictPolicy>("copies");
  const [restorePreferences, setRestorePreferences] = useState(fresh);
  const [openSession, setOpenSession] = useState(fresh);
  const [mappings, setMappings] = useState<BackupPathMapping[]>([]);
  const [error, setError] = useState<string | null>(null);
  const locations = useMemo(() => listBackupLocations(backup), [backup]);
  const preview = useMemo(() => planBackupWorkspaceNames(backup.workspaces, existing, conflicts), [backup, existing, conflicts]);
  const existingNames = new Set(existing.map(({ name }) => name.toLowerCase()));
  const hasConflicts = backup.workspaces.some(({ name }) => existingNames.has(name.toLowerCase()));
  const canImport = backup.workspaces.length > 0 || restorePreferences || openSession;

  const apply = () => {
    try {
      applyStratumBackup(remapBackupLocations(backup, mappings), { conflicts, restorePreferences, openSession });
      onImported();
    } catch (error) {
      setError(toMessage(error, "Couldn't import the backup."));
    }
  };

  return (
    <section className="settings-backup-review" aria-labelledby={titleId}>
      <header className="settings-backup-heading">
        <div className="settings-section-title" id={titleId}>Review import</div>
        <p className="settings-desc">
          {full ? "Full backup" : "Workspaces only"} ({preview.length} {preview.length === 1 ? "workspace" : "workspaces"})
        </p>
      </header>
      {hasConflicts ? (
        <div className="settings-backup-choice">
          <span id={conflictLabelId} className="settings-desc">Matching workspace names</span>
          <SettingsPills aria-labelledby={conflictLabelId}>
            {CONFLICT_OPTIONS.map(({ value, label }) => (
              <PressButton key={value} type="button" className={`settings-pill${value === conflicts ? " is-active" : ""}`}
                aria-pressed={value === conflicts} onClick={() => setConflicts(value)}>
                {label}
              </PressButton>
            ))}
          </SettingsPills>
        </div>
      ) : null}
      {preview.length ? (
        <ul className="settings-backup-list" aria-label="Workspaces to import">
          {preview.map(({ workspace, name, replacingId }) => (
            <li key={workspace.id} className="settings-backup-preview-row">
              <span>{name}</span>
              {replacingId || workspace.draft ? (
                <span className="settings-desc">
                  {replacingId ? "Replaces saved workspace" : "Includes draft"}
                  {replacingId && workspace.draft ? ", includes draft" : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {full ? (
        <div className="settings-backup-restore">
          <SettingsCheckbox aria-describedby={restoreDescriptionId} checked={restorePreferences}
            onChange={(event) => setRestorePreferences(event.currentTarget.checked)}>
            Apply app settings, shortcuts, and rename presets
          </SettingsCheckbox>
          <p className="settings-desc" id={restoreDescriptionId}>Keeps the FFmpeg path configured on this PC.</p>
          <SettingsCheckbox checked={openSession} onChange={(event) => setOpenSession(event.currentTarget.checked)}>
            Open the backed-up session
          </SettingsCheckbox>
        </div>
      ) : null}
      <BackupPathReview locations={locations} mappings={mappings} setMappings={setMappings} />
      {error ? <p className="settings-desc settings-desc-error" role="alert">{error}</p> : null}
      <div className="settings-actions settings-backup-footer">
        <PressButton type="button" className="btn ghost" onClick={onCancel}>Cancel</PressButton>
        <PressButton type="button" className="btn" disabled={!canImport} onClick={apply}>Import backup</PressButton>
      </div>
    </section>
  );
};
