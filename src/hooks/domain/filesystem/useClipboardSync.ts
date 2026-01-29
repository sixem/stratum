// Keeps the internal clipboard store in sync with OS file clipboard contents.
import { useCallback, useEffect, useRef } from "react";
import { getClipboardPaths } from "@/api";
import { useClipboardStore } from "@/modules";

type UseClipboardSyncOptions = {
  enabled: boolean;
  contextMenuOpen: boolean;
};

export const useClipboardSync = ({ enabled, contextMenuOpen }: UseClipboardSyncOptions) => {
  // Coalesce overlapping OS clipboard reads to avoid redundant native calls.
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);

  const refreshFromOs = useCallback(async () => {
    if (!enabled) return null;
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return null;
    }
    refreshInFlightRef.current = true;
    try {
      const paths = await getClipboardPaths();
      if (paths.length === 0) {
        useClipboardStore.getState().clearClipboard();
        return paths;
      }
      useClipboardStore.getState().setClipboard(paths);
      return paths;
    } catch {
      return null;
    } finally {
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        void refreshFromOs();
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const handleFocus = () => {
      void refreshFromOs();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [enabled, refreshFromOs]);

  useEffect(() => {
    if (!enabled || !contextMenuOpen) return;
    void refreshFromOs();
  }, [contextMenuOpen, enabled, refreshFromOs]);

  return { refreshFromOs };
};
