import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PerfProfiler } from "@/components";
import { initDebug } from "@/lib";

// Initialize debug logging before the app renders.
initDebug();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PerfProfiler id="app">
      <App />
    </PerfProfiler>
  </React.StrictMode>,
);
