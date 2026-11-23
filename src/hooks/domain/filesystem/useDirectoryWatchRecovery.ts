// Maintain one native watch per visible folder and retry failed watches on focus.
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startDirWatch, stopDirWatch } from "@/api";
import { folderPathKey, makeDebug } from "@/lib";

type Pane = "main" | "bottom";
type ActiveWatch = {
  key: string;
  failed: boolean;
  failureVersion: number;
  restart: () => Promise<void>;
};

const RECOVERY_COOLDOWN_MS = 5000;
const activeWatches: Partial<Record<Pane, ActiveWatch>> = {};
const log = makeDebug("watch");

export const markDirectoryWatchFailed = (pane: Pane, path: string) => {
  const watch = activeWatches[pane];
  if (watch?.key !== folderPathKey(path)) return;
  watch.failed = true;
  watch.failureVersion += 1;
};

type Options = {
  enabled: boolean;
  pane: Pane;
  sharesWatch: boolean;
  path: string;
  refreshFolder: (path: string) => void;
};

export const useDirectoryWatchRecovery = ({ enabled, pane, sharesWatch, path, refreshFolder }: Options) => {
  const focusTarget = useRef({ path, sharesWatch });
  useEffect(() => {
    focusTarget.current = { path, sharesWatch };
  }, [path, sharesWatch]);

  useEffect(() => {
    if (!enabled || sharesWatch || !path.trim()) return;
    const target = path.trim();
    let starting: Promise<void> | null = null;

    const openWatch = (restart?: boolean) => {
      if (starting) return starting;
      const failureVersion = watch.failureVersion;
      starting = startDirWatch(target, pane, restart).then(() => {
        // A newer failure from a native callback belongs to this same watch.
        if (watch.failureVersion === failureVersion) watch.failed = false;
      }, (error) => {
        watch.failed = true;
        log("start watch failed: %o", error);
      }).finally(() => { starting = null; });
      return starting;
    };
    const watch: ActiveWatch = {
      key: folderPathKey(target),
      failed: false,
      failureVersion: 0,
      restart: () => openWatch(true),
    };
    activeWatches[pane] = watch;
    void openWatch();

    return () => {
      if (activeWatches[pane] === watch) delete activeWatches[pane];
      void stopDirWatch(pane).catch((error) => log("stop watch failed: %o", error));
    };
  }, [enabled, pane, path, sharesWatch]);

  useEffect(() => {
    if (!enabled) return;
    let lastRecovery: { watch: ActiveWatch; at: number } | undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const onFocus = () => {
      if (disposed) return;
      const target = focusTarget.current;
      const owner = target.sharesWatch ? "main" : pane;
      const watch = activeWatches[owner];
      const now = Date.now();
      if (!watch?.failed || watch.key !== folderPathKey(target.path)) return;
      if (lastRecovery?.watch === watch && now - lastRecovery.at < RECOVERY_COOLDOWN_MS) return;
      lastRecovery = { watch, at: now };
      // Both panes share the open request. Relist after it settles so edits
      // during the failed watch are covered by either the listing or new events.
      void watch.restart().then(() => {
        if (!disposed && activeWatches[owner] === watch && focusTarget.current === target) {
          refreshFolder(target.path);
        }
      });
    };
    void getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) onFocus();
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => {
      if (disposed) return;
      window.addEventListener("focus", onFocus);
      unlisten = () => window.removeEventListener("focus", onFocus);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled, pane, refreshFolder]);
};
