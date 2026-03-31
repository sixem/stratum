// Keeps the DOM's window-focus dataset aligned with native or browser focus events.
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const useAppWindowFocusEffects = (isTauriEnv: boolean) => {
  useEffect(() => {
    const root = document.documentElement;
    const syncDomWindowFocus = () => {
      root.dataset.windowFocus = document.hasFocus() ? "true" : "false";
    };

    if (!isTauriEnv) {
      syncDomWindowFocus();
      window.addEventListener("focus", syncDomWindowFocus);
      window.addEventListener("blur", syncDomWindowFocus);

      return () => {
        window.removeEventListener("focus", syncDomWindowFocus);
        window.removeEventListener("blur", syncDomWindowFocus);
      };
    }

    let mounted = true;
    let unlistenFocusChange: null | (() => void) = null;
    const appWindow = getCurrentWindow();

    // Use Tauri's native focus events so clicking the draggable title area does
    // not briefly look like the window lost focus.
    void appWindow
      .isFocused()
      .then((focused) => {
        if (!mounted) return;
        root.dataset.windowFocus = focused ? "true" : "false";
      })
      .catch(() => {
        if (!mounted) return;
        syncDomWindowFocus();
      });

    void appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (!mounted) return;
        root.dataset.windowFocus = focused ? "true" : "false";
      })
      .then((unlisten) => {
        if (!mounted) {
          unlisten();
          return;
        }
        unlistenFocusChange = unlisten;
      })
      .catch(() => {
        if (!mounted) return;
        syncDomWindowFocus();
        window.addEventListener("focus", syncDomWindowFocus);
        window.addEventListener("blur", syncDomWindowFocus);
        unlistenFocusChange = () => {
          window.removeEventListener("focus", syncDomWindowFocus);
          window.removeEventListener("blur", syncDomWindowFocus);
        };
      });

    return () => {
      mounted = false;
      unlistenFocusChange?.();
    };
  }, [isTauriEnv]);
};
