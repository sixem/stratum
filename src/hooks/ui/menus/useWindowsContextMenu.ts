import { useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { showShellContextMenu, type ShellMenuTarget } from "@/api";
import type { BeginFileActivity } from "@/hooks/domain/filesystem/useFileActivity";
import { toMessage } from "@/lib";
import { usePromptStore } from "@/modules";

type Options = {
  enabled: boolean;
  closeContextMenu: () => void;
  beginFileActivity: BeginFileActivity;
  onCommand: () => void;
};

export const useWindowsContextMenu = ({
  enabled, closeContextMenu, beginFileActivity, onCommand,
}: Options) => {
  const open = useRef(false);
  return useCallback((
    target: ShellMenuTarget,
    point: { x: number; y: number },
    extended = false,
    onOpenGallery?: () => void,
  ) => {
    if (!enabled) return false;
    if (open.current) return true;
    open.current = true;
    flushSync(closeContextMenu);
    const finish = beginFileActivity("Windows context menu");
    void showShellContextMenu(target, point, extended, onOpenGallery != null)
      .then((outcome) => {
        if (outcome === "invoked") onCommand();
        if (outcome === "gallery") onOpenGallery?.();
      })
      .catch((error) => {
        usePromptStore.getState().showPrompt({
          title: "Couldn't open the Windows menu",
          content: toMessage(error, "Windows couldn't show the menu or run its command."),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      })
      .finally(() => {
        open.current = false;
        finish();
      });
    return true;
  }, [beginFileActivity, closeContextMenu, enabled, onCommand]);
};
