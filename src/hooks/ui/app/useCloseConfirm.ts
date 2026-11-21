// Shows a close confirmation prompt when the window is requested to close.
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CloseRequestedEvent } from "@tauri-apps/api/window";
import { makeDebug } from "@/lib";
import { usePromptStore } from "@/modules";

const log = makeDebug("window");

type CloseConfirmOptions = {
  enabled: boolean;
  confirmClose: boolean;
  onBeforeClose?: () => void;
  onBeforePrompt?: () => boolean;
};

export const useCloseConfirm = ({
  enabled,
  confirmClose,
  onBeforeClose,
  onBeforePrompt,
}: CloseConfirmOptions) => {
  const confirmRef = useRef(confirmClose);
  const onBeforeCloseRef = useRef(onBeforeClose);
  const onBeforePromptRef = useRef(onBeforePrompt);
  // Once the user confirms, let the next close request pass through.
  const allowCloseRef = useRef(false);

  useEffect(() => {
    confirmRef.current = confirmClose;
  }, [confirmClose]);
  useEffect(() => {
    onBeforeCloseRef.current = onBeforeClose;
  }, [onBeforeClose]);
  useEffect(() => {
    onBeforePromptRef.current = onBeforePrompt;
  }, [onBeforePrompt]);

  useEffect(() => {
    if (!enabled) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenClose: (() => void) | null = null;
    let promptTimer: number | null = null;

    const handleCloseRequest = (event: CloseRequestedEvent) => {
      if (disposed) {
        // Tauri would otherwise close the window from this stale listener.
        event.preventDefault();
        return;
      }
      onBeforeCloseRef.current?.();
      if (!confirmRef.current) return;
      if (allowCloseRef.current) return;
      event.preventDefault();

      const promptStore = usePromptStore.getState();
      if (promptStore.prompt || promptTimer !== null) return;

      const showClosePrompt = () => {
        const activePromptStore = usePromptStore.getState();
        if (activePromptStore.prompt) return;
        activePromptStore.showPrompt({
          title: "Close Stratum?",
          content: "Are you sure you want to close the window?",
          confirmLabel: "Close",
          cancelLabel: "Cancel",
          onConfirm: () => {
            allowCloseRef.current = true;
            // Use destroy to bypass close-requested events and avoid double-close clicks.
            void appWindow.destroy().catch(() => {
              allowCloseRef.current = false;
            });
          },
        });
      };

      // Let overlays like quick preview close first so the prompt is not hidden behind them.
      const delayedPrompt = onBeforePromptRef.current?.() ?? false;
      if (delayedPrompt) {
        promptTimer = window.setTimeout(() => {
          promptTimer = null;
          showClosePrompt();
        }, 0);
        return;
      }

      showClosePrompt();
    };

    void appWindow.onCloseRequested(handleCloseRequest)
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenClose = unlisten;
      })
      .catch((error) => log("close request listener failed: %o", error));

    return () => {
      disposed = true;
      if (promptTimer !== null) window.clearTimeout(promptTimer);
      unlistenClose?.();
    };
  }, [enabled]);
};
