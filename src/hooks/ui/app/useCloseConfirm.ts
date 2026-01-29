// Shows a close confirmation prompt when the window is requested to close.
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CloseRequestedEvent } from "@tauri-apps/api/window";
import { usePromptStore } from "@/modules";

type CloseConfirmOptions = {
  enabled: boolean;
  confirmClose: boolean;
  onBeforeClose?: () => void;
};

export const useCloseConfirm = ({
  enabled,
  confirmClose,
  onBeforeClose,
}: CloseConfirmOptions) => {
  const confirmRef = useRef(confirmClose);
  const onBeforeCloseRef = useRef(onBeforeClose);
  // Once the user confirms, let the next close request pass through.
  const allowCloseRef = useRef(false);

  useEffect(() => {
    confirmRef.current = confirmClose;
  }, [confirmClose]);
  useEffect(() => {
    onBeforeCloseRef.current = onBeforeClose;
  }, [onBeforeClose]);

  useEffect(() => {
    if (!enabled) return;
    const appWindow = getCurrentWindow();
    let unlistenClose: (() => void) | null = null;

    const handleCloseRequest = (event: CloseRequestedEvent) => {
      onBeforeCloseRef.current?.();
      if (!confirmRef.current) return;
      if (allowCloseRef.current) return;
      event.preventDefault();
      const promptStore = usePromptStore.getState();
      if (promptStore.prompt) return;
      promptStore.showPrompt({
        title: "Close Stratum?",
        content: "Are you sure you want to close the window?",
        confirmLabel: "Close",
        cancelLabel: "Cancel",
        onConfirm: () => {
          allowCloseRef.current = true;
          void appWindow.close();
        },
      });
    };

    const setup = async () => {
      unlistenClose = await appWindow.onCloseRequested(handleCloseRequest);
    };

    void setup();

    return () => {
      if (unlistenClose) {
        unlistenClose();
      }
    };
  }, [enabled]);
};
