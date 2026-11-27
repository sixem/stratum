// Resolve only breadcrumbs whose directory identity is unknown from the listing.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDisplayedRemoteDirectory, type RemotePaneDirectory } from "@/hooks/ui/menus/usePaneTransferTarget";
import type { PathCrumb } from "@/lib/pathCrumbs";
import type { LinkTarget } from "./useRemoteLinks";

function listedPath(directory: RemotePaneDirectory, path: string) {
  if (path === directory.displayedPath) return directory.path;
  if (path === "/" || directory.path === path || directory.path.startsWith(path + "/")) return path;
}

export function useRemoteCrumbTargets(pane: "main" | "bottom", profileId: string | undefined, path: string, crumbs: PathCrumb[]) {
  const directory = useDisplayedRemoteDirectory(pane, profileId, path);
  const [resolved, setResolved] = useState<{ directory: RemotePaneDirectory; paths: Map<string, string> }>();
  useEffect(() => {
    if (!directory) return;
    let active = true;
    void (async () => {
      const paths = new Map<string, string>();
      for (const crumb of crumbs) {
        if (listedPath(directory, crumb.path)) continue;
        const target = await invoke<LinkTarget>("remote_resolve_target", {
          profileId: directory.profileId, sessionId: directory.sessionId, path: crumb.path,
        }).catch(() => undefined);
        if (!active) return;
        if (target?.kind === "directory") {
          paths.set(crumb.path, target.path);
          setResolved({ directory, paths: new Map(paths) });
        }
      }
    })();
    return () => { active = false; };
  }, [directory, crumbs]);
  return {
    sessionId: directory?.sessionId,
    destination: (crumb: string) => directory && (listedPath(directory, crumb) ??
      (resolved?.directory === directory ? resolved.paths.get(crumb) : undefined)),
  };
}
