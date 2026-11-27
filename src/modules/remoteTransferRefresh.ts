// Refresh displayed source and destination directories as individual jobs settle.
import { getPaneDirectory } from "@/hooks/ui/menus/usePaneTransferTarget";
import { getParentPath, normalizePath } from "@/lib/paths";
import { remoteParent } from "@/lib/remotePaths";
import { bumpDirectoryChildVersions } from "./directoryChildState";
import { remoteDirectoryChanged } from "./remoteDirectoryChanges";

type RemoteLocation = { profileId: string; sessionId: number; path: string };
const pending = new Map<string, number>();

// A multi-item drop can complete many small jobs together; bound refresh work.
function schedule(key: string, run: () => void) {
  if (pending.has(key)) return;
  pending.set(key, window.setTimeout(() => { pending.delete(key); run(); }, 100));
}

function remote(location: RemoteLocation) {
  for (const path of new Set([location.path, remoteParent(location.path)])) {
    schedule(JSON.stringify(["remote", location.profileId, location.sessionId, path]), () =>
      remoteDirectoryChanged({ ...location, path }));
  }
}

function local(folder: string) {
  if (!folder) return;
  schedule(JSON.stringify(["local", normalizePath(folder)]), () => {
    bumpDirectoryChildVersions([folder]);
    for (const pane of ["main", "bottom"] as const) {
      const location = getPaneDirectory(pane);
      if (location?.kind === "local" && normalizePath(location.path) === normalizePath(folder)) {
        void Promise.resolve().then(() => location.refresh?.()).catch(() => {});
      }
    }
  });
}

export const refreshRemoteTransferDirectory = remote;
export const refreshLocalTransferDirectory = local;

export function refreshRemoteTransferViews(input: {
  sourcePath: string; remote: RemoteLocation; localFolder: string; direction: "upload" | "download";
  moving: boolean; remoteTarget?: RemoteLocation;
}) {
  const { sourcePath, direction, moving, remote: sourceOrTarget, remoteTarget } = input;
  if (direction === "upload") {
    remote(sourceOrTarget);
    if (moving) { const parent = getParentPath(sourcePath); if (parent) local(parent); }
  } else {
    if (moving) remote(sourceOrTarget);
    if (remoteTarget) remote(remoteTarget);
    else local(input.localFolder);
  }
}
