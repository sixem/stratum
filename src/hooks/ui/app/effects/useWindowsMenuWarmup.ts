// Prepare the native menu once when it is the default and the app is idle.
import { useEffect } from "react";
import { warmShellContextMenu } from "@/api/shellContextMenu";
import { useSettingsStore } from "@/modules";

export function useWindowsMenuWarmup(isTauri: boolean) {
  const nativeItemMenu = useSettingsStore((state) => state.menuUseWindowsForItems);

  useEffect(() => {
    if (!isTauri || !nativeItemMenu) return;
    let idle: number | undefined;
    const warm = () => {
      if (document.visibilityState === "visible") void warmShellContextMenu().catch(() => {});
    };
    const timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(warm);
      } else {
        warm();
      }
    }, 1500);

    return () => {
      window.clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
    };
  }, [isTauri, nativeItemMenu]);
}
