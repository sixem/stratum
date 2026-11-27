// Export a whole profile by default, with named workspaces available as a smaller backup.
import { SettingsPills } from "./SettingsPills";
import { useState } from "react";
import { openStratumBackup, saveStratumBackup } from "@/api/backup";
import { PressButton } from "@/components/primitives/PressButton";
import { toMessage } from "@/lib";
import { captureStratumBackup } from "@/modules/backup/profile";
import { readStratumBackup } from "@/modules/backup/schema";
import type { StratumBackup } from "@/modules/backup/types";
import { useWorkspaceStore } from "@/modules/workspaceStore";
import { BackupImportReview } from "./BackupImportReview";
import { SettingsCheckbox } from "./SettingsCheckbox";
import { SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const BACKUP_SETTINGS_ITEMS = {
  export: {
    label: "Export backup",
    description: "Save settings, workspaces, and the current session to a Stratum backup file.",
    keywords: "save config profile workspace settings JSON",
  },
  import: {
    label: "Import backup",
    description: "Review a backup and remap locations before importing it.",
    keywords: "restore config profile workspace settings JSON",
  },
} satisfies Record<string, SettingsItemText>;

export const SettingsBackupSection = ({ sectionId }: { sectionId: string }) => {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const [scope, setScope] = useState<StratumBackup["scope"]>("full");
  const [selection, setSelection] = useState(() => new Set(workspaces.map(({ id }) => id)));
  const [review, setReview] = useState<{ backup: StratumBackup; key: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const selectedWorkspaces = workspaces.filter(({ id }) => selection.has(id));

  const exportBackup = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const backup = captureStratumBackup(scope, selection);
      if (await saveStratumBackup(backup)) {
        setFeedback({ kind: "success", text: "Backup exported." });
      }
    } catch (error) {
      setFeedback({ kind: "error", text: toMessage(error, "Couldn't export the backup.") });
    } finally {
      setBusy(false);
    }
  };

  const reviewBackup = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const data = await openStratumBackup();
      if (data !== null) {
        const backup = readStratumBackup(data);
        setReview((previous) => ({ backup, key: (previous?.key ?? 0) + 1 }));
      }
    } catch (error) {
      setFeedback({ kind: "error", text: toMessage(error, "Couldn't open the backup.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Backup &amp; restore</div>
      <SettingsItem item={BACKUP_SETTINGS_ITEMS.export} className="is-stacked">
        <div className="settings-backup-export">
          <SettingsPills aria-label="Export scope">
            <PressButton
              type="button"
              className={`settings-pill${scope === "full" ? " is-active" : ""}`}
              aria-pressed={scope === "full"}
              disabled={busy}
              onClick={() => setScope("full")}
            >Full backup</PressButton>
            <PressButton
              type="button"
              className={`settings-pill${scope === "workspaces" ? " is-active" : ""}`}
              aria-pressed={scope === "workspaces"}
              disabled={busy}
              onClick={() => setScope("workspaces")}
            >Workspaces only</PressButton>
          </SettingsPills>
          {scope === "workspaces" ? workspaces.length ? (
            <ul className="settings-backup-list" aria-label="Workspaces to export">
              {workspaces.map(({ id, name }) => (
                <li key={id}>
                  <SettingsCheckbox
                    checked={selection.has(id)}
                    disabled={busy}
                    onChange={(event) => {
                      const selected = event.currentTarget.checked;
                      setSelection((previous) => {
                        const next = new Set(previous);
                        if (selected) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    }}
                  >
                    {name}
                  </SettingsCheckbox>
                </li>
              ))}
            </ul>
          ) : <p className="settings-desc">Save a named workspace first to export it on its own.</p> : null}
          <div className="settings-actions">
            <PressButton type="button" className="btn" disabled={busy || (scope === "workspaces" && !selectedWorkspaces.length)} onClick={exportBackup}>
              Export…
            </PressButton>
          </div>
        </div>
      </SettingsItem>
      <SettingsItem item={BACKUP_SETTINGS_ITEMS.import}>
        <PressButton type="button" className="btn" disabled={busy} onClick={reviewBackup}>Choose file…</PressButton>
      </SettingsItem>
      {review ? (
        <BackupImportReview
          key={review.key}
          backup={review.backup}
          onCancel={() => setReview(null)}
          onImported={() => {
            setReview(null);
            setFeedback({ kind: "success", text: "Backup imported." });
          }}
        />
      ) : null}
      {feedback ? (
        <p className={`settings-desc${feedback.kind === "error" ? " settings-desc-error" : ""}`} role={feedback.kind === "error" ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}
    </section>
  );
};
