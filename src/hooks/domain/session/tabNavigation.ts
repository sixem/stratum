// Record completed folder visits and expose the workspace's recent jumps.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { folderPathKey } from "@/lib";
import { subscribeToFolderRename } from "@/modules/renamedFolderLocations";
import { useBottomSessionStore, useSessionStore } from "@/modules/sessionStore";
import { useSettingsStore } from "@/modules/settings.store";

const NO_RECENT_LOCATIONS: string[] = [];

export const useRecentJumps = (limit: number) => {
  const remember = useSettingsStore((state) => state.rememberRecentLocations);
  const recentJumps = useSessionStore((state) => state.recentJumps);
  const legacyBottomJumps = useBottomSessionStore((state) => state.recentJumps);

  return useMemo(() => {
    if (!remember) return NO_RECENT_LOCATIONS;
    if (!legacyBottomJumps.length) {
      return recentJumps.length <= limit ? recentJumps : recentJumps.slice(0, limit);
    }

    // Older profiles kept separate histories. Keep their lower-pane entries reachable.
    const locations = new Map<string, string>();
    for (const path of [...recentJumps, ...legacyBottomJumps]) {
      const key = folderPathKey(path);
      if (key && !locations.has(key)) locations.set(key, path);
      if (locations.size === limit) break;
    }
    return [...locations.values()];
  }, [legacyBottomJumps, limit, recentJumps, remember]);
};

export const removeRecentJump = (path: string) => {
  const key = folderPathKey(path);
  if (!key) return;
  const remove = (paths: string[]) => {
    const next = paths.filter((item) => folderPathKey(item) !== key);
    return next.length === paths.length ? paths : next;
  };
  useSessionStore.getState().setRecentJumps(remove);
  useBottomSessionStore.getState().setRecentJumps(remove);
};

type PendingJumpSource = "navigate" | "switch";

type UsePendingJumpOptions = {
  activeTabId: string | null;
  currentPath: string;
  recentLimit: number;
};

export const usePendingJump = ({
  activeTabId,
  currentPath,
  recentLimit,
}: UsePendingJumpOptions) => {
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const pendingSourceRef = useRef<PendingJumpSource | null>(null);
  const pendingTabRef = useRef<string | null>(null);
  const recordRecentRef = useRef(false);

  useEffect(() => subscribeToFolderRename((mapPath) => {
    setPendingJump((path) => path ? mapPath(path) : path);
  }), []);

  const queuePendingJump = useCallback(
    (path: string, source: PendingJumpSource, tabId?: string | null) => {
      pendingSourceRef.current = source;
      pendingTabRef.current = source === "navigate" ? tabId ?? activeTabId : null;
      recordRecentRef.current = useSettingsStore.getState().rememberRecentLocations;
      setPendingJump(path);
    },
    [activeTabId],
  );

  const shouldSyncEmptyTab = useCallback((tabId: string | null) => {
    return (
      pendingSourceRef.current === "navigate" && pendingTabRef.current === tabId
    );
  }, []);

  useEffect(() => {
    // Update recent jumps after navigation completes.
    if (!pendingJump) return;
    if (pendingSourceRef.current === "switch" || pendingTabRef.current !== activeTabId) {
      setPendingJump(null);
      pendingSourceRef.current = null;
      pendingTabRef.current = null;
      return;
    }
    const pendingKey = folderPathKey(pendingJump);
    const currentKey = folderPathKey(currentPath);
    if (!pendingKey || pendingKey !== currentKey) return;
    if (recordRecentRef.current && useSettingsStore.getState().rememberRecentLocations) {
      // Both panes contribute to the current workspace's history.
      useSessionStore.getState().setRecentJumps((prev) => {
        const next = [pendingJump, ...prev.filter((item) => folderPathKey(item) !== pendingKey)];
        return next.slice(0, recentLimit);
      });
    }
    setPendingJump(null);
    pendingSourceRef.current = null;
    pendingTabRef.current = null;
  }, [activeTabId, currentPath, pendingJump, recentLimit]);

  return { queuePendingJump, shouldSyncEmptyTab };
};
