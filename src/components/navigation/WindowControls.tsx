// Right-aligned window caption controls for the custom path bar title area.
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  WindowCloseIcon,
  WindowMaximizeIcon,
  WindowMinimizeIcon,
} from "@/components/icons";
import { PressButton } from "@/components/primitives/PressButton";

const isTauriEnv = () => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

const runWindowAction = (action: "minimize" | "toggleMaximize" | "close") => {
  if (!isTauriEnv()) return;
  const appWindow = getCurrentWindow();
  void appWindow[action]().catch(() => {
    // Ignore window-control failures so the shell remains responsive.
  });
};

export const WindowControls = () => {
  if (!isTauriEnv()) {
    return null;
  }

  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <PressButton
        type="button"
        className="window-control-button"
        pressOnPointerDown={false}
        onClick={() => runWindowAction("minimize")}
        aria-label="Minimize window"
      >
        <WindowMinimizeIcon className="window-control-icon is-minimize" />
      </PressButton>
      <PressButton
        type="button"
        className="window-control-button"
        pressOnPointerDown={false}
        onClick={() => runWindowAction("toggleMaximize")}
        aria-label="Maximize or restore window"
      >
        <WindowMaximizeIcon className="window-control-icon" />
      </PressButton>
      <PressButton
        type="button"
        className="window-control-button is-close"
        pressOnPointerDown={false}
        onClick={() => runWindowAction("close")}
        aria-label="Close window"
      >
        <WindowCloseIcon className="window-control-icon" />
      </PressButton>
    </div>
  );
};
