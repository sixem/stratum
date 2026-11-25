import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getIndexingLaunchPreferences } from "@/api/system";
import { PerfProfiler } from "@/components";
import { initDebug } from "@/lib";
import { hasStoredIndexingPreference, useSettingsStore } from "@/modules/settings.store";
import { applyStartupSession } from "@/modules/startupSession";
import { shouldShowWelcomeOnFirstLaunch } from "@/modules/welcome";

// Initialize debug logging before the app renders.
initDebug();

if (import.meta.hot) {
  const HMR_RELOAD_MATCHERS = [
    "useSelectionDrag",
    "useEntryDragOut",
    "usePinnedPlaceDragDrop",
    "useTabDragDrop",
  ];
  // Fast Refresh can leave drag-related listeners in a bad state, so hard reload on those updates.
  import.meta.hot.on("vite:beforeUpdate", (payload) => {
    const shouldReload = payload.updates.some((update) => {
      const target = update.path ?? update.acceptedPath ?? "";
      return HMR_RELOAD_MATCHERS.some((matcher) => target.includes(matcher));
    });
    if (shouldReload) {
      window.location.reload();
    }
  });
}

const startApp = async () => {
  // Import the old launch file only if the settings store has no saved choice.
  if ("__TAURI_INTERNALS__" in window && !hasStoredIndexingPreference()) {
    try {
      const legacy = await getIndexingLaunchPreferences();
      if (legacy) useSettingsStore.getState().updateSettings(legacy);
    } catch (error) {
      console.warn("Couldn't read the previous indexing preference", error);
    }
  }

  const showWelcome = shouldShowWelcomeOnFirstLaunch();
  try {
    applyStartupSession();
  } catch (error) {
    // If persisting the previous workspace fails, let the saved session open.
    console.warn("Couldn't apply the startup preference", error);
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <PerfProfiler id="app">
        <App showWelcome={showWelcome} />
      </PerfProfiler>
    </React.StrictMode>,
  );
};

void startApp();
