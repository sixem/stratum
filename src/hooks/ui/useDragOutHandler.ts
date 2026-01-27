// Coordinates drag-out operations and prevents concurrent drag sessions.
import { useCallback, useRef } from "react";
import { startDrag, statEntries } from "@/api";
import { makeDebug } from "@/lib";
import { usePromptStore } from "@/modules";

type UseDragOutHandlerOptions = {
  viewParentPath: string | null;
  onRefresh: () => void | Promise<void>;
};

const shouldRefreshAfterMove = async (paths: string[]) => {
  try {
    const meta = await statEntries(paths);
    // Missing entries return no size or modified timestamp from the backend.
    return meta.some((entry) => entry.size == null && entry.modified == null);
  } catch {
    // Fallback to refreshing so we don't hide missing items on failures.
    return true;
  }
};

const log = makeDebug("drag");

export const useDragOutHandler = ({
  viewParentPath,
  onRefresh,
}: UseDragOutHandlerOptions) => {
  const dragInFlightRef = useRef(false);

  return useCallback(
    (paths: string[]) => {
      if (dragInFlightRef.current) return;
      const blocked = viewParentPath ? new Set([viewParentPath]) : null;
      const seen = new Set<string>();
      const unique: string[] = [];
      paths.forEach((path) => {
        const trimmed = path.trim();
        if (!trimmed) return;
        if (blocked?.has(trimmed)) return;
        if (seen.has(trimmed)) return;
        seen.add(trimmed);
        unique.push(trimmed);
      });
      if (unique.length === 0) return;

      dragInFlightRef.current = true;
      if (log.enabled) {
        log("drag-out: start count=%d", unique.length);
      }
      void startDrag(unique)
        .then(async (outcome) => {
          if (log.enabled) {
            log("drag-out: outcome=%s", outcome ?? "none");
          }
          if (outcome !== "move") return;
          // Only refresh if items actually left the current folder.
          if (await shouldRefreshAfterMove(unique)) {
            await onRefresh();
          }
        })
        .catch((error) => {
          const message =
            error instanceof Error && error.message
              ? error.message
              : "Failed to start drag.";
          if (log.enabled) {
            log("drag-out: failed %s", message);
          }
          usePromptStore.getState().showPrompt({
            title: "Drag failed",
            content: message,
            confirmLabel: "OK",
            cancelLabel: null,
          });
        })
        .finally(() => {
          dragInFlightRef.current = false;
        });
    },
    [onRefresh, viewParentPath],
  );
};
