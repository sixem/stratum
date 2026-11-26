// Manual checks and background checks share one request. Only a user action can apply an update.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import { toMessage } from "@/lib/fsUtils";
import { APP_VERSION } from "@/constants/app";
import { useSettingsStore } from "./settings.store";
import { scheduleUpdate, UPDATE_DAY_MS } from "./updateSchedule";

export type UpdateRelease = {
  version: string;
  publishedAt: string;
  notes: string;
  action: "install" | "portable" | "msi";
};
type Status = "idle" | "checking" | "current" | "available" | "applying" | "error" | "confirmTerminals";
type UpdateState = {
  dialogOpen: boolean;
  offerVisible: boolean;
  release: UpdateRelease | null;
  status: Status;
  message: string | null;
  nextCheck: number;
  open: () => void;
  close: () => void;
  checkManually: () => Promise<void>;
  apply: () => Promise<void>;
  confirmRestart: () => Promise<void>;
};

// If a release was already eligible, revalidate it on next launch to restore the indicator.
// A current installation, or a release inside the waiting period, keeps its deadline across restarts.
const scheduleKey = "stratum.update.next." + APP_VERSION;
function readDeadline() {
  try {
    const stored = Number(localStorage.getItem(scheduleKey));
    if (Number.isFinite(stored) && stored <= Date.now() + UPDATE_DAY_MS) return stored;
  } catch { /* Storage may be unavailable. */ }
  return 0;
}
function saveDeadline(value: number) {
  try { localStorage.setItem(scheduleKey, String(value)); } catch { /* In-memory timer still works. */ }
}

export const useUpdateStore = create<UpdateState>((set, get) => {
  const apply = async (confirmedTerminals: boolean) => {
    const { release, status } = get();
    if (!release || status !== (confirmedTerminals ? "confirmTerminals" : "available")) return;
    set({ status: "applying", message: null });
    try {
      await invoke("apply_app_update", { version: release.version, publishedAt: release.publishedAt, confirmedTerminals });
      // Manual downloads open in the browser. A successful installer closes Stratum.
      set({ status: "available", dialogOpen: false });
    } catch (error) {
      const message = toMessage(error, "Could not apply this update.");
      if (message === "terminal-confirmation-required") {
        set({ status: "confirmTerminals" });
      } else {
        set({ status: "error", release: null, offerVisible: false, message });
        saveDeadline(0);
      }
    }
  };
  return {
    dialogOpen: false, offerVisible: false, release: null, status: "idle", message: null,
    nextCheck: readDeadline(),
    open: () => set({ dialogOpen: true }),
    close: () => {
      if (get().status === "applying") return;
      set({ dialogOpen: false, status: get().status === "confirmTerminals" ? "available" : get().status });
    },
    checkManually: async () => {
      set({ dialogOpen: true });
      await checkForUpdates();
    },
    apply: () => apply(false),
    confirmRestart: () => apply(true),
  };
});

export function invalidateUpdateSchedule() {
  saveDeadline(0);
  useUpdateStore.setState({ nextCheck: 0, offerVisible: false });
}

export async function checkForUpdates() {
  const { status } = useUpdateStore.getState();
  if (status === "checking" || status === "applying" || status === "confirmTerminals") return;
  const set = useUpdateStore.setState;
  set({ status: "checking", message: null, release: null, offerVisible: false });
  try {
    if (!isTauri()) throw new Error("Update checks are unavailable in this build.");
    const release = await invoke<UpdateRelease | null>("check_app_update");
    const { updateDelayHours, autoCheckUpdates } = useSettingsStore.getState();
    const { eligible, nextCheck } = scheduleUpdate(release?.publishedAt, updateDelayHours, Date.now());
    saveDeadline(eligible ? 0 : nextCheck);
    set({ status: release ? "available" : "current", release, offerVisible: eligible && autoCheckUpdates, nextCheck });
  } catch (error) {
    // Background failures stay silent. Settings can always retry immediately.
    const nextCheck = Date.now() + UPDATE_DAY_MS;
    saveDeadline(nextCheck);
    set({ status: "error", message: toMessage(error, "Could not check for updates."), nextCheck });
  }
}
