// Coordinates drag-out operations and prevents concurrent drag sessions.
import { useCallback, useEffect, useRef } from "react";
import { cancelDragStart, startDrag } from "@/api";
import { getPathName, makeDebug, toMessage } from "@/lib";
import type { BeginFileActivity } from "@/hooks/domain/filesystem/useFileActivity";
import { usePromptStore } from "@/modules";

type UseDragOutHandlerOptions = {
  beginFileActivity: BeginFileActivity;
  viewParentPath: string | null;
  onRefresh: () => void | Promise<void>;
};

const log = makeDebug("drag");
let lastDragId = 0;

export const useDragOutHandler = ({
  beginFileActivity,
  viewParentPath,
  onRefresh,
}: UseDragOutHandlerOptions) => {
  const active = useRef<(() => void) | null>(null);
  useEffect(() => () => active.current?.(), []);

  return useCallback(
    async (paths: string[], folderPath?: string) => {
      if (active.current) return;
      const unique = Array.from(new Set(paths.filter((path) => path && path !== viewParentPath)));
      if (unique.length === 0) return;

      // Use a monotonic ID across WebView reloads. A late cancellation belongs
      // to its original button press, even if the next drag is already preparing.
      const id = Math.max(Date.now() * 1000, lastDragId + 1);
      lastDragId = id;
      const listeners = new AbortController();
      const finish = beginFileActivity(unique.length === 1
        ? `Dragging ${getPathName(unique[0])}` : `Dragging ${unique.length} items`);
      const cancel = () => {
        active.current = null;
        listeners.abort();
        finish();
        void cancelDragStart(id).catch((error) => log("cancel drag start: %o", error));
      };
      active.current = cancel;
      const options = { capture: true, signal: listeners.signal };
      window.addEventListener("pointerup", cancel, options);
      window.addEventListener("pointercancel", cancel, options);
      window.addEventListener("pointerdown", cancel, options);
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") cancel();
      }, options);
      if (log.enabled) {
        log("drag-out: start count=%d", unique.length);
      }
      let outcome;
      try {
        outcome = await startDrag(unique, id, unique.length === 1 && unique[0] === folderPath);
      } catch (error) {
        const message = toMessage(error, "Failed to start drag.");
        log("drag-out: failed %s", message);
        usePromptStore.getState().showPrompt({
          title: "Drag failed",
          content: message,
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return;
      } finally {
        // A second gesture can begin while the first move's listing is refreshing.
        listeners.abort();
        finish();
        if (active.current === cancel) active.current = null;
      }
      log("drag-out: outcome=%s", outcome);
      if (outcome === "move") await onRefresh();
    },
    [beginFileActivity, onRefresh, viewParentPath],
  );
};
