// Tracks which directory query may update the view when IPC replies arrive out of order.
import { folderPathKey } from "../../../lib/paths.ts";
import type { ListDirQuery, LoadDirOptions } from "./fileManager.types";

export const buildQueryKey = (path: string, query: ListDirQuery) =>
  `${folderPathKey(path)}:${query.sort.key}:${query.sort.dir}:${query.search.trim().toLowerCase()}`;

export type DirectoryRequest = {
  path: string;
  key: string;
  query: ListDirQuery;
  foreground: boolean;
};

export class DirectoryRequests {
  displayed: DirectoryRequest | null = null;
  pending: DirectoryRequest | null = null;

  start(path: string, key: string, query: ListDirQuery, cached: boolean, options?: LoadDirOptions) {
    if (options?.silent) {
      // Watch and mutation refreshes belong to the folder that launched them.
      const target = folderPathKey(path);
      if (!this.displayed || target !== folderPathKey(this.displayed.path)) return null;
      if (this.pending && target !== folderPathKey(this.pending.path)) return null;
      if (this.pending?.foreground && this.pending.key !== key) return null;
    }
    if (!options?.force &&
        (this.pending?.key === key || (!this.pending && this.displayed?.key === key))) {
      return null;
    }
    const foreground = !cached && (!options?.silent || Boolean(this.pending?.foreground));
    this.pending = { path, key, query, foreground };
    return this.pending;
  }

  commit(request: DirectoryRequest) {
    if (this.pending !== request) return false;
    this.displayed = request;
    return true;
  }

  finish(request: DirectoryRequest) {
    if (this.pending !== request) return false;
    this.pending = null;
    return true;
  }

  clear() {
    this.pending = null;
    this.displayed = null;
  }
}
