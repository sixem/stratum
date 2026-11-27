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

export const canBrowseEntry = (entry: RemoteEntry) => entry.isDir;

// Large images can use a cached gallery thumbnail; the backend only reads
// original image bytes automatically when the file is within its limit.
export const canPreviewRemote = (entry: RemoteEntry) => !entry.isDir && !entry.isSymlink &&
  entry.size !== null && entry.size > 0 && /\.(?:jpe?g|jpe|jfif|png|webp|gif|bmp|tiff?|ico)$/i.test(entry.name);

export const canPreviewRemoteVideo = (entry: RemoteEntry) => !entry.isDir && !entry.isSymlink &&
  entry.size !== null && entry.size > 0 && entry.modified !== null &&
  /\.(?:mp4|m4v|webm|mov|mkv|avi|wmv|mpeg|mpg|mpe|flv|3gp|ogv)$/i.test(entry.name);
