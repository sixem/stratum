// Explorer-style cut feedback follows the current file clipboard across folders.
import { useMemo } from "react";
import { folderPathKey } from "@/lib";
import { useClipboardStore } from "@/modules";

export const useCutEntries = () => {
  const paths = useClipboardStore(({ clipboard }) => clipboard?.mode === "move" ? clipboard.paths : null);
  return useMemo(() => {
    const cut = paths && new Set(paths.map(folderPathKey));
    return (path: string) => cut?.has(folderPathKey(path)) ?? false;
  }, [paths]);
};
