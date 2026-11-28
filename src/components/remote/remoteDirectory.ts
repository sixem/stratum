// Remote names are case-sensitive. Whitespace and backslashes can be literal filename characters.
import type { FileEntry, SortState } from "@/types";
import { compareFolderEntries } from "../../lib/folderEntryOrder.ts";

export type RemoteEntry = FileEntry & { isSymlink?: boolean };

export { remoteParent, remoteCrumbs } from "../../lib/remotePaths.ts";

export function displayRemoteEntries(entries: RemoteEntry[], sort: SortState, search: string, showHidden: boolean) {
  const query = search.toLowerCase();
  return entries.filter(entry => (showHidden || !entry.name.startsWith(".")) && entry.name.toLowerCase().includes(query))
    .sort((a, b) => compareFolderEntries(a, b, sort, true));
}

export const canBrowseEntry = (entry: RemoteEntry) => entry.isDir;

// Large images can use a cached gallery thumbnail; the backend only reads
// original image bytes automatically when the file is within its limit.
export const canPreviewRemote = (entry: RemoteEntry) => !entry.isDir && !entry.isSymlink &&
  entry.size !== null && entry.size > 0 && /\.(?:jpe?g|jpe|jfif|png|webp|gif|bmp|tiff?|ico)$/i.test(entry.name);

export const canPreviewRemoteVideo = (entry: RemoteEntry) => !entry.isDir && !entry.isSymlink &&
  entry.size !== null && entry.size > 0 && entry.modified !== null &&
  /\.(?:mp4|m4v|webm|mov|mkv|avi|wmv|mpeg|mpg|mpe|flv|3gp|ogv)$/i.test(entry.name);
