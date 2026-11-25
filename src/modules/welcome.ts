// Persist setup completion independently of settings written during startup.
import { PLACES_STORAGE_KEY, SESSION_LEGACY_STORAGE_KEY, SESSION_STORAGE_KEY } from "@/constants";
import { SETTINGS_STORAGE_KEY } from "@/constants/settings";
import { useSettingsStore } from "./settings.store";
import type { Settings } from "./settings.types";
import type { ViewMode } from "@/types";

export type WelcomeSettings = Pick<Settings, "darkMode" | "accentTheme"> & { defaultViewMode: ViewMode };

const WELCOME_STORAGE_KEY = "stratum.welcome";
const EXISTING_PROFILE_KEYS = [
  SETTINGS_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  SESSION_LEGACY_STORAGE_KEY,
  PLACES_STORAGE_KEY,
];

export const shouldShowWelcomeOnFirstLaunch = () => {
  try {
    const storage = globalThis.localStorage;
    const state = storage.getItem(WELCOME_STORAGE_KEY);
    if (state === "seen") return false;
    if (state !== "pending" && EXISTING_PROFILE_KEYS.some((key) => storage.getItem(key) !== null)) {
      storage.setItem(WELCOME_STORAGE_KEY, "seen");
      return false;
    }

    // Startup may write default places before the user dismisses the prompt.
    storage.setItem(WELCOME_STORAGE_KEY, "pending");
    return true;
  } catch {
    return false;
  }
};

export const finishWelcome = (settings?: WelcomeSettings) => {
  if (settings) useSettingsStore.getState().updateSettings(settings);
  try {
    globalThis.localStorage.setItem(WELCOME_STORAGE_KEY, "seen");
  } catch {
    // Finish the current setup even when storage is unavailable.
  }
};
