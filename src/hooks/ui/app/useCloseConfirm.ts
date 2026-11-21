// Route native close requests through the workspace warning or regular confirmation.
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CloseRequestedEvent } from "@tauri-apps/api/window";
import { showWorkspaceClosePrompt } from "@/components/overlay/WorkspaceClosePrompt";
import { makeDebug } from "@/lib";
import { captureWorkspaceLayout } from "@/lib/captureWorkspaceLayout";
import { usePromptStore, useSettingsStore } from "@/modules";
import { getWorkspaceChanges, useWorkspaceStore } from "@/modules/workspaceStore";

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
    let closing = false;
    let unlistenClose: (() => void) | null = null;
    let promptTimer: number | null = null;

    const closeWindow = () => {
      if (closing) return;
      closing = true;
      // Destroy bypasses the listener so a confirmed close cannot show another prompt.
      void appWindow.destroy().catch((error) => {
        closing = false;
        log("window close failed: %o", error);
      });
    };

    const handleCloseRequest = (event: CloseRequestedEvent) => {
      if (disposed || closing) {
        event.preventDefault();
        return;
      }
      onBeforeCloseRef.current?.();
      const warnOnUnsaved = useSettingsStore.getState().warnOnUnsavedWorkspaces;
      const changes = warnOnUnsaved && useWorkspaceStore.getState().workspaces.length
        ? getWorkspaceChanges(captureWorkspaceLayout()) : [];
      if (!changes.length && !confirmRef.current) return;
      event.preventDefault();

      const promptStore = usePromptStore.getState();
      if (promptStore.prompt || promptTimer !== null) return;

      const showClosePrompt = () => {
        const activePromptStore = usePromptStore.getState();
        if (activePromptStore.prompt) return;
        if (changes.length) {
          showWorkspaceClosePrompt(changes, closeWindow);
          return;
        }
        activePromptStore.showPrompt({
          title: "Close Stratum?",
          content: "Are you sure you want to close the window?",
          confirmLabel: "Close",
          cancelLabel: "Cancel",
          onConfirm: closeWindow,
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
