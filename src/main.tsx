import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PerfProfiler } from "@/components";
import { initDebug } from "@/lib";

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PerfProfiler id="app">
      <App />
    </PerfProfiler>
  </React.StrictMode>,
);
