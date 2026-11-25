// Keep transfer destinations tied to open, displayed directory views.
import { useLayoutEffect, useMemo } from "react";
import { create } from "zustand";

type Pane = "main" | "bottom";
type PaneDirectory = { path: string; refresh?: () => Promise<void> };
const usePaneDirectories = create<Partial<Record<Pane, PaneDirectory>>>(() => ({}));

export function usePaneTransferTarget(pane: Pane, path: string, refresh?: PaneDirectory["refresh"]) {
  const otherPane = pane === "main" ? "bottom" : "main";
  const target = usePaneDirectories((state) => path ? state[otherPane] : undefined);

  useLayoutEffect(() => {
    if (!path) return;
    usePaneDirectories.setState({ [pane]: { path, refresh } });
    return () => { usePaneDirectories.setState({ [pane]: undefined }); };
  }, [pane, path, refresh]);

  return useMemo(() => target && {
    path: target.path,
    run: async (transfer: (destination: string) => Promise<unknown> | void) => {
      // The destination shown in the menu must still be open when invoked.
      if (usePaneDirectories.getState()[otherPane] !== target) return;
      try {
        await transfer(target.path);
      } finally {
        const current = usePaneDirectories.getState()[otherPane];
        if (current?.path === target.path) await current.refresh?.();
      }
    },
  }, [otherPane, target]);
}
