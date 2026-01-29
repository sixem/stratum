// Pending navigation helpers for tab session flows.
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizePath } from "@/lib";

type PendingJumpSource = "navigate" | "switch";

type UsePendingJumpOptions = {
  activeTabId: string | null;
  currentPath: string;
  recentLimit: number;
  setRecentJumps: (updater: (prev: string[]) => string[]) => void;
};

export const usePendingJump = ({
  activeTabId,
  currentPath,
  recentLimit,
  setRecentJumps,
}: UsePendingJumpOptions) => {
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const pendingSourceRef = useRef<PendingJumpSource | null>(null);
  const pendingTabRef = useRef<string | null>(null);

  const queuePendingJump = useCallback(
    (path: string, source: PendingJumpSource, tabId?: string | null) => {
      pendingSourceRef.current = source;
      pendingTabRef.current = source === "navigate" ? tabId ?? activeTabId : null;
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
    if (pendingSourceRef.current === "switch") {
      setPendingJump(null);
      pendingSourceRef.current = null;
      pendingTabRef.current = null;
      return;
    }
    const pendingKey = normalizePath(pendingJump);
    const currentKey = normalizePath(currentPath);
    if (!pendingKey || pendingKey !== currentKey) return;
    setRecentJumps((prev) => {
      const next = [pendingJump, ...prev.filter((item) => normalizePath(item) !== pendingKey)];
      return next.slice(0, recentLimit);
    });
    setPendingJump(null);
    pendingSourceRef.current = null;
    pendingTabRef.current = null;
  }, [currentPath, pendingJump, recentLimit, setRecentJumps]);

  return { queuePendingJump, shouldSyncEmptyTab };
};
