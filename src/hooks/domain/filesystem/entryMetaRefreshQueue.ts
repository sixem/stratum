// Tracks watcher invalidations until a stat observes the latest change.
import { folderPathKey } from "../../../lib/paths.ts";
import type { EntryMeta } from "@/types";
import type { MetaRequestOptions } from "./fileManager.types";

const MAX_LOOKUP_ATTEMPTS = 3;

type FileCheck = NonNullable<MetaRequestOptions["onFileChecked"]>;
type RefreshEntry = { path: string; attempts: number; onFileChecked?: FileCheck };
type CheckedFile = { path: string; meta: EntryMeta | null; notify: FileCheck };
type RefreshBatch = { revision: number; entries: Map<string, RefreshEntry> };

export class EntryMetaRefreshQueue {
  private readonly changed = new Map<string, RefreshEntry>();
  private visible = new Map<string, string>();
  private listing = false;
  private revision = 0;

  setListingPending(pending: boolean) {
    this.listing = pending;
    if (pending) this.revision += 1;
  }

  setVisible(paths: string[]) {
    this.visible = new Map(paths.map((path) => [folderPathKey(path), path]));
  }

  invalidate(path: string, onFileChecked?: FileCheck) {
    this.changed.set(folderPathKey(path), { path, attempts: 0, onFileChecked });
  }

  has(pathKey: string) {
    return this.changed.has(pathKey);
  }

  get ready() {
    return !this.listing && this.changed.size > 0;
  }

  take(limit: number): RefreshBatch {
    const entries = new Map<string, RefreshEntry>();
    for (const key of this.visible.keys()) {
      if (entries.size >= limit) break;
      const entry = this.changed.get(key);
      if (entry) entries.set(key, entry);
    }
    for (const [key, entry] of this.changed) {
      if (entries.size >= limit) break;
      entries.set(key, entry);
    }
    return { revision: this.revision, entries };
  }

  complete(batch: RefreshBatch, results: EntryMeta[]) {
    const updates: EntryMeta[] = [];
    const failedPaths: string[] = [];
    const checkedFiles: CheckedFile[] = [];
    let retry = false;
    // A new listing can carry an older snapshot. Read again once it settles.
    if (this.listing || this.revision !== batch.revision) return { updates, failedPaths, checkedFiles, retry };
    const byPath = new Map(results.map((meta) => [folderPathKey(meta.path), meta]));
    for (const [key, entry] of batch.entries) {
      // A change during the lookup has its own ticket and stays queued.
      if (this.changed.get(key) !== entry) continue;
      this.changed.delete(key);
      const meta = byPath.get(key);
      if (meta && (!entry.onFileChecked || meta.size != null)) {
        const path = this.visible.get(key) ?? meta.path;
        updates.push(path === meta.path ? meta : { ...meta, path });
        if (entry.onFileChecked) checkedFiles.push({ path: entry.path, meta, notify: entry.onFileChecked });
      } else if (++entry.attempts < MAX_LOOKUP_ATTEMPTS) {
        this.changed.set(key, entry);
        retry = true;
      } else {
        failedPaths.push(entry.path);
        if (entry.onFileChecked) checkedFiles.push({ path: entry.path, meta: null, notify: entry.onFileChecked });
      }
    }
    return { updates, failedPaths, checkedFiles, retry };
  }

  clear() {
    this.changed.clear();
    this.visible.clear();
    this.listing = false;
    this.revision += 1;
  }
}
