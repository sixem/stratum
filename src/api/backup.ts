// Native file dialogs keep the backup destination under the user's control.
import { invoke } from "@tauri-apps/api/core";
import type { StratumBackup } from "@/modules/backup/types";

export const openStratumBackup = () => invoke<string | null>("open_stratum_backup");

export const saveStratumBackup = (backup: StratumBackup) => {
  const date = new Date(backup.createdAt);
  const [month, day, hour, minute, second] = [
    date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(),
  ].map((part) => String(part).padStart(2, "0"));
  const timestamp = `${date.getFullYear()}-${month}-${day}_${hour}-${minute}-${second}`;
  const kind = backup.scope === "full" ? "backup" : "workspaces";

  return invoke<boolean>("save_stratum_backup", {
    data: JSON.stringify(backup, null, 2),
    fileName: `Stratum-${kind}-${timestamp}.json`,
  });
};

export const probeBackupFolders = (paths: string[]) => invoke<string[]>("probe_backup_folders", { paths });
