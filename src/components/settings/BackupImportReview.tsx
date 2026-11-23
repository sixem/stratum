// Review the workspace merge, portable settings, and path remaps before import.
import { useId, useMemo, useState } from "react";
import { DropdownSelect, type DropdownGroup } from "@/components/primitives/DropdownSelect";
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

type Props = { backup: StratumBackup; onCancel: () => void; onImported: () => void };

const CONFLICT_OPTIONS: DropdownGroup[] = [{
  id: "matching-workspaces",
  options: [{ value: "replace", label: "Replace matching workspaces" }],
}];

export const BackupImportReview = ({ backup, onCancel, onImported }: Props) => {
  const titleId = useId();
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
    <section className="settings-backup-review settings-backup-form" aria-labelledby={titleId}>
      <div className="settings-section-title" id={titleId}>Review import</div>
      <p className="settings-desc">
        {full ? "Full backup" : "Workspaces only"} · {preview.length} {preview.length === 1 ? "workspace" : "workspaces"}
      </p>
      {hasConflicts ? (
        <div className="settings-backup-choice">
          <span>Matching workspace names</span>
          <DropdownSelect
            ariaLabel="Matching workspace names"
            value={conflicts === "replace" ? "replace" : null}
            placeholder="Keep both"
            groups={CONFLICT_OPTIONS}
            onChange={(value) => setConflicts(value === "replace" ? "replace" : "copies")}
          />
        </div>
      ) : null}
      {preview.length ? (
        <ul className="settings-backup-list" aria-label="Workspaces to import">
          {preview.map(({ workspace, name, replacingId }) => (
            <li key={workspace.id}>
              <span>{name}</span>
              {replacingId ? <span className="settings-desc"> · Replaces saved workspace</span> : null}
              {workspace.draft ? <span className="settings-desc"> · Includes draft</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {full ? (
        <div className="settings-backup-form">
          <label className="settings-backup-check">
            <input type="checkbox" checked={restorePreferences} onChange={(event) => setRestorePreferences(event.currentTarget.checked)} />
            <span>Apply app settings, shortcuts, and rename presets</span>
          </label>
          {restorePreferences ? <p className="settings-desc">FFmpeg uses the executable configured on this PC.</p> : null}
          <label className="settings-backup-check">
            <input type="checkbox" checked={openSession} onChange={(event) => setOpenSession(event.currentTarget.checked)} />
            <span>Open the backed-up session</span>
          </label>
        </div>
      ) : null}
      <BackupPathReview locations={locations} mappings={mappings} setMappings={setMappings} />
      {error ? <p className="settings-desc settings-desc-error" role="alert">{error}</p> : null}
      <div className="settings-actions">
        <PressButton type="button" className="btn ghost" onClick={onCancel}>Cancel</PressButton>
        <PressButton type="button" className="btn" disabled={!canImport} onClick={apply}>Import backup</PressButton>
      </div>
    </section>
  );
};
