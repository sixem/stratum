// Keeps transient UI state aligned with the active view and tab lifecycle.
import { useEffect, useRef } from "react";
import { useTooltipStore } from "@/modules";
import type { AppEffectActions, AppEffectView } from "./appEffectTypes";

type UseAppViewCleanupEffectsOptions = Pick<
  AppEffectView,
  | "activeTabId"
  | "activeTabPath"
  | "currentPath"
  | "sidebarOpen"
  | "viewMode"
  | "contextMenuOpen"
  | "loading"
> &
  Pick<AppEffectActions, "clearDir" | "setRenameTarget" | "setRenameValue"> & {
    viewLog: (...args: unknown[]) => void;
  };

export const useAppViewCleanupEffects = ({
  activeTabId,
  activeTabPath,
  currentPath,
  sidebarOpen,
  viewMode,
  contextMenuOpen,
  loading,
  clearDir,
  setRenameTarget,
  setRenameValue,
  viewLog,
}: UseAppViewCleanupEffectsOptions) => {
  const lastActiveTabIdRef = useRef<string | null>(null);

  useEffect(() => {
    useTooltipStore.getState().hideTooltip();
  }, [activeTabId, currentPath, sidebarOpen, viewMode]);

  useEffect(() => {
    if (!contextMenuOpen) return;
    const tooltip = useTooltipStore.getState();
    tooltip.hideTooltip();
    tooltip.blockTooltips();
  }, [contextMenuOpen]);

  useEffect(() => {
    // Clear rename state on navigation or view switches.
    setRenameTarget(null);
    setRenameValue("");
  }, [activeTabId, currentPath, setRenameTarget, setRenameValue, viewMode]);

  useEffect(() => {
    if (activeTabId === lastActiveTabIdRef.current) return;
    lastActiveTabIdRef.current = activeTabId;
    const tabPath = activeTabPath ?? "";
    if (!tabPath.trim() && currentPath.trim()) {
      // Ensure untitled tabs show the lander instead of the previous tab contents.
      clearDir({ silent: true });
    }
  }, [activeTabId, activeTabPath, clearDir, currentPath]);

  useEffect(() => {
    viewLog(
      "view change: tab=%s path=%s mode=%s loading=%s",
      activeTabId ?? "none",
      currentPath,
      viewMode,
      loading ? "yes" : "no",
    );
  }, [activeTabId, currentPath, loading, viewMode, viewLog]);
};
