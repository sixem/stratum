// Syncs the native window title to the active path.
import { useEffect, useState } from "react";
import { getIdentifier } from "@tauri-apps/api/app";
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
  const [freshProfile, setFreshProfile] = useState(false);

  useEffect(() => {
    if (!import.meta.env.DEV || !isTauriEnv) return;
    let active = true;
    void getIdentifier().then((identifier) => {
      if (active) setFreshProfile(identifier.startsWith("com.emy.stratum.dev-fresh-"));
    }).catch(() => {});
    return () => { active = false; };
  }, [isTauriEnv]);

  useEffect(() => {
    if (!isTauriEnv) return;
    const trimmed = viewPath?.trim() ?? "";
    const appWindow = getCurrentWindow();
    const isUntitled = trimmed.toLowerCase() === "untitled";
    const title =
      trimmed && !isUntitled ? `${trimmed} - ${appName} ${appVersion}` : `${appName} ${appVersion}`;
    void appWindow.setTitle(freshProfile ? `${title} (Fresh profile)` : title);
  }, [appName, appVersion, freshProfile, isTauriEnv, viewPath]);
};
