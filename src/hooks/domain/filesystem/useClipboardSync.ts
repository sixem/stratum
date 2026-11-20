// Refresh the clipboard snapshot used for menu availability on focus and open.
import { useEffect } from "react";
import { refreshFileClipboard } from "@/modules";

type UseClipboardSyncOptions = { enabled: boolean; contextMenuOpen: boolean };

const refreshFromOs = () => refreshFileClipboard().catch(() => null);

export const useClipboardSync = ({ enabled, contextMenuOpen }: UseClipboardSyncOptions) => {
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { void refreshFromOs(); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [enabled]);

  useEffect(() => {
    if (enabled && contextMenuOpen) void refreshFromOs();
  }, [enabled, contextMenuOpen]);

  return { refreshFromOs };
};
