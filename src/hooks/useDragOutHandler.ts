// Coordinates drag-out operations and prevents concurrent drag sessions.
import { useCallback, useRef } from "react";
import { startDrag } from "@/api";
import { usePromptStore } from "@/modules";

type UseDragOutHandlerOptions = {
  viewParentPath: string | null;
  onRefresh: () => void | Promise<void>;
};

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
      void startDrag(unique)
        .then((outcome) => {
          if (outcome === "move") {
            void onRefresh();
          }
        })
        .catch((error) => {
          const message =
            error instanceof Error && error.message
              ? error.message
              : "Failed to start drag.";
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
