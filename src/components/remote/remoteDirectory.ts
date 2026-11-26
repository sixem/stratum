// Remote names are case-sensitive. Whitespace and backslashes can be literal filename characters.
import type { FileEntry, SortState } from "@/types";

export type RemoteEntry = FileEntry & { isSymlink?: boolean };

export { remoteParent, remoteCrumbs } from "../../lib/remotePaths.ts";

const byName = new Intl.Collator(undefined, { numeric: true });
export function displayRemoteEntries(entries: RemoteEntry[], sort: SortState, search: string, showHidden: boolean) {
  const query = search.toLowerCase();
  return entries.filter(entry => (showHidden || !entry.name.startsWith(".")) && entry.name.toLowerCase().includes(query))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      const direction = sort.dir === "asc" ? 1 : -1;
      if (sort.key !== "name") {
        const left = a[sort.key], right = b[sort.key];
        if (left === null && right !== null) return 1;
        if (right === null && left !== null) return -1;
        if (left !== null && right !== null && left !== right) return (left - right) * direction;
      }
      return byName.compare(a.name, b.name) * (sort.key === "name" ? direction : 1);
    });
}

export const canBrowseEntry = (entry: RemoteEntry) => entry.isDir || Boolean(entry.isSymlink);

// Match the native raster decoder's input budget before sending any content requests.
export const canPreviewRemote = (entry: RemoteEntry) => !entry.isDir && !entry.isSymlink &&
  entry.size !== null && entry.size > 0 && entry.size <= 1024 * 1024 && /\.(?:jpe?g|png|webp)$/i.test(entry.name);
