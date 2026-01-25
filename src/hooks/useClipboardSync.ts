// Keeps the internal clipboard store in sync with OS file clipboard contents.
import { useCallback, useEffect } from "react";
import { getClipboardPaths } from "@/api";
import { useClipboardStore } from "@/modules";

type UseClipboardSyncOptions = {
  enabled: boolean;
  contextMenuOpen: boolean;
};

export const useClipboardSync = ({ enabled, contextMenuOpen }: UseClipboardSyncOptions) => {
  const refreshFromOs = useCallback(async () => {
    if (!enabled) return null;
    try {
      const paths = await getClipboardPaths();
      if (paths.length === 0) {
        useClipboardStore.getState().clearClipboard();
        return [];
      }
      useClipboardStore.getState().setClipboard(paths);
      return paths;
    } catch {
      return null;
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
