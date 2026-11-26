// Defer the first check until the shell is ready. Timer and subscriptions live outside the render loop.
import { useEffect } from "react";
import { useSettingsStore } from "@/modules/settings.store";
import { checkForUpdates, invalidateUpdateSchedule, useUpdateStore } from "@/modules/updateStore";

export function useUpdateChecks(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    let timer: number;
    const schedule = () => {
      window.clearTimeout(timer);
      const { status, dialogOpen, nextCheck } = useUpdateStore.getState();
      if (dialogOpen || status === "checking" || status === "applying" || !useSettingsStore.getState().autoCheckUpdates) return;
      timer = window.setTimeout(checkForUpdates, Math.max(3_000, nextCheck - Date.now()));
    };
    const onSettingsChange = useSettingsStore.subscribe((next, previous) => {
      if (next.autoCheckUpdates === previous.autoCheckUpdates && next.updateDelayHours === previous.updateDelayHours) return;
      invalidateUpdateSchedule();
    });
    const onUpdateChange = useUpdateStore.subscribe(schedule);
    schedule();
    return () => {
      window.clearTimeout(timer);
      onSettingsChange();
      onUpdateChange();
    };
  }, [ready]);
}
