// Explorer-style cut feedback follows the current file clipboard across folders.
import { useMemo } from "react";
import { folderPathKey } from "@/lib";
import { useClipboardStore } from "@/modules";

export const useCutEntries = (remoteProfileId?: string) => {
  const remote = useClipboardStore(state => remoteProfileId && state.remote?.profileId === remoteProfileId && state.remote.mode === "move" ? state.remote.entries : null);
  const paths = useClipboardStore(({ clipboard }) => clipboard?.mode === "move" ? clipboard.paths : null);
  return useMemo(() => {
    if (remoteProfileId) {
      const cut = new Set(remote?.map(entry => entry.path));
      return (path: string) => cut.has(path);
    }
    const cut = paths && new Set(paths.map(folderPathKey));
    return (path: string) => cut?.has(folderPathKey(path)) ?? false;
  }, [paths, remote, remoteProfileId]);
};
