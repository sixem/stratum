// Keep transfer destinations tied to open, displayed directory views.
import { useLayoutEffect, useMemo } from "react";
import { create } from "zustand";

type Pane = "main" | "bottom";
type PaneDirectory = { kind: "local"; path: string; refresh?: () => Promise<void> };
export type RemotePaneDirectory = { kind: "remote"; path: string; profileId: string; sessionId: number; refresh: () => void };
type PaneLocation = PaneDirectory | RemotePaneDirectory;
const usePaneDirectories = create<Partial<Record<Pane, PaneLocation>>>(() => ({}));

// A remote pane registers its actual host and session, never a POSIX path as
// a Windows destination. Identity checks keep old menu actions from retargeting.
export function useRemotePaneDirectory(pane: Pane, location: RemotePaneDirectory | undefined) {
  useLayoutEffect(() => {
    if (!location) return;
    usePaneDirectories.setState({ [pane]: location });
    return () => {
      if (usePaneDirectories.getState()[pane] === location) usePaneDirectories.setState({ [pane]: undefined });
    };
  }, [pane, location]);
}

export function useOtherPaneDirectory(pane: Pane) {
  const otherPane = pane === "main" ? "bottom" : "main";
  return usePaneDirectories(state => state[otherPane]);
}

export function isCurrentPaneDirectory(pane: Pane, directory: PaneLocation) {
  return usePaneDirectories.getState()[pane === "main" ? "bottom" : "main"] === directory;
}

export function getPaneDirectory(pane: Pane) {
  return usePaneDirectories.getState()[pane];
}

export function usePaneTransferTarget(pane: Pane, path: string, refresh?: PaneDirectory["refresh"]) {
  const otherPane = pane === "main" ? "bottom" : "main";
  const target = usePaneDirectories((state) => path && state[otherPane]?.kind === "local" ? state[otherPane] as PaneDirectory : undefined);

  useLayoutEffect(() => {
    if (!path) return;
    const directory: PaneDirectory = { kind: "local", path, refresh };
    usePaneDirectories.setState({ [pane]: directory });
    return () => { if (usePaneDirectories.getState()[pane] === directory) usePaneDirectories.setState({ [pane]: undefined }); };
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
