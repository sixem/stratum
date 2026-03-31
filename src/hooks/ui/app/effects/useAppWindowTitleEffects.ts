// Syncs the native window title to the active path.
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type UseAppWindowTitleEffectsOptions = {
  isTauriEnv: boolean;
  appName: string;
  appVersion: string;
  viewPath: string;
};

export const useAppWindowTitleEffects = ({
  isTauriEnv,
  appName,
  appVersion,
  viewPath,
}: UseAppWindowTitleEffectsOptions) => {
  useEffect(() => {
    if (!isTauriEnv) return;
    const trimmed = viewPath?.trim() ?? "";
    const appWindow = getCurrentWindow();
    const isUntitled = trimmed.toLowerCase() === "untitled";
    const title =
      trimmed && !isUntitled ? `${trimmed} - ${appName} ${appVersion}` : `${appName} ${appVersion}`;
    void appWindow.setTitle(title);
  }, [appName, appVersion, isTauriEnv, viewPath]);
};
