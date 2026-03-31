// Detects the Windows version once so the shell can apply platform-specific chrome tweaks.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export const useWindowsVersionEffects = (isTauriEnv: boolean) => {
  useEffect(() => {
    const root = document.documentElement;
    if (!isTauriEnv) {
      delete root.dataset.windowsVersion;
      return;
    }

    let mounted = true;
    void invoke<boolean>("is_windows_11")
      .then((isWindows11) => {
        if (!mounted) return;
        if (isWindows11) {
          root.dataset.windowsVersion = "11";
        } else {
          delete root.dataset.windowsVersion;
        }
      })
      .catch(() => {
        if (!mounted) return;
        delete root.dataset.windowsVersion;
      });

    return () => {
      mounted = false;
    };
  }, [isTauriEnv]);
};
