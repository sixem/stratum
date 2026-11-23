// Native file dialogs keep the backup destination under the user's control.
import { invoke } from "@tauri-apps/api/core";

export const openStratumBackup = () => invoke<string | null>("open_stratum_backup");
export const saveStratumBackup = (data: string) => invoke<boolean>("save_stratum_backup", { data });
export const probeBackupFolders = (paths: string[]) => invoke<string[]>("probe_backup_folders", { paths });
