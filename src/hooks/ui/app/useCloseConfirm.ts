// Negotiate unsaved workspaces and drain native jobs before closing the window.
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CloseRequestedEvent } from "@tauri-apps/api/window";
import {
  beginTransferShutdown,
  reopenTransferQueue,
  waitForTransferShutdown,
  type TransferShutdownMode,
} from "@/api/transferShutdown";
import { showWorkspaceClosePrompt } from "@/components/overlay/WorkspaceClosePrompt";
import { makeDebug, toMessage } from "@/lib";
import { captureWorkspaceLayout } from "@/lib/captureWorkspaceLayout";
import { usePromptStore, useSettingsStore } from "@/modules";
import type { PromptConfig } from "@/modules";
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
    let stopWaiting: (() => void) | null = null;

    // Let quick preview close first so it cannot cover the confirmation.
    const present = (show: () => void) => {
      const showIfAvailable = () => {
        if (!disposed && !usePromptStore.getState().prompt) show();
      };
      if (onBeforePromptRef.current?.()) {
        promptTimer = window.setTimeout(() => {
          promptTimer = null;
          showIfAvailable();
        }, 0);
        return;
      }
      showIfAvailable();
    };

    const showFailure = (error: unknown) => {
      log("window close failed: %o", error);
      if (disposed || usePromptStore.getState().prompt) return;
      usePromptStore.getState().showPrompt({
        title: "Couldn't close Stratum",
        content: toMessage(error, "Try closing the window again."),
        aboveOverlays: true,
      });
    };

    const waitForJobs = async (ticket: number, mode: "wait" | "cancel") => {
      const { showPrompt, hidePrompt } = usePromptStore.getState();
      let stayingOpen = false;
      const stayOpen = new Promise<boolean>((resolve) => {
        stopWaiting = () => {
          stayingOpen = true;
          resolve(false);
        };
      });
      const prompt: PromptConfig = {
        title: mode === "wait" ? "Waiting for jobs" : "Stopping jobs",
        content: mode === "wait"
          ? "Stratum will close when the remaining jobs finish."
          : "Stratum will close once the jobs stop safely.",
        aboveOverlays: true,
        blocking: true,
        confirmLabel: null,
        cancelLabel: "Keep open",
        onCancel: () => stopWaiting?.(),
      };
      showPrompt(prompt);
      try {
        const ready = await Promise.race([waitForTransferShutdown(ticket), stayOpen]);
        return ready && !stayingOpen;
      } finally {
        stopWaiting = null;
        hidePrompt(prompt);
      }
    };

    const startClose = async (mode: TransferShutdownMode, askToClose = false) => {
      if (closing || disposed) return;
      closing = true;
      let ticket: number | null = null;
      let destroyed = false;
      try {
        ticket = await beginTransferShutdown(mode);
        if (disposed) return;
        if (ticket === null) {
          present(() => usePromptStore.getState().showPrompt({
            title: "Jobs in progress",
            content: "Waiting will resume paused jobs.",
            confirmLabel: "Wait for jobs",
            onConfirm: () => void startClose("wait"),
            cancelLabel: "Keep open",
            actions: [{ label: "Cancel jobs and close", onClick: () => void startClose("cancel") }],
            aboveOverlays: true,
          }));
          return;
        }
        if (askToClose) {
          await reopenTransferQueue(ticket);
          ticket = null;
          present(() => usePromptStore.getState().showPrompt({
            title: "Close Stratum?",
            content: "Are you sure you want to close the window?",
            confirmLabel: "Close",
            onConfirm: () => void startClose("idleOnly"),
            cancelLabel: "Cancel",
          }));
          return;
        }
        if (mode !== "idleOnly" && !(await waitForJobs(ticket, mode))) return;
        if (disposed) return;
        onBeforeCloseRef.current?.();
        // Keep admission closed from the drain through native window destruction.
        await appWindow.destroy();
        destroyed = true;
      } catch (error) {
        showFailure(error);
      } finally {
        if (!destroyed) {
          if (ticket !== null) {
            try {
              await reopenTransferQueue(ticket);
            } catch (error) {
              showFailure(error);
            }
          }
          closing = false;
        }
      }
    };

    const handleCloseRequest = (event: CloseRequestedEvent) => {
      event.preventDefault();
      if (disposed || closing || promptTimer !== null || usePromptStore.getState().prompt) return;

      const warnOnUnsaved = useSettingsStore.getState().warnOnUnsavedWorkspaces;
      const changes = warnOnUnsaved && useWorkspaceStore.getState().workspaces.length
        ? getWorkspaceChanges(captureWorkspaceLayout()) : [];
      if (changes.length) {
        present(() => showWorkspaceClosePrompt(changes, () => void startClose("idleOnly")));
        return;
      }
      void startClose("idleOnly", confirmRef.current);
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
      stopWaiting?.();
      if (promptTimer !== null) window.clearTimeout(promptTimer);
      unlistenClose?.();
    };
  }, [enabled]);
};
