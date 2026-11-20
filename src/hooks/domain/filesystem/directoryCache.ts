// Holds recent directory listings within a snapshot and entry budget.
import type { DirCacheEntry } from "./fileManager.types";

export class DirectoryCache {
  private readonly snapshots = new Map<string, DirCacheEntry>();
  private readonly maxSnapshots: number;
  private readonly maxEntries: number;

  constructor(maxSnapshots: number, maxEntries: number) {
    this.maxSnapshots = maxSnapshots;
    this.maxEntries = maxEntries;
  }

  get(key: string) {
    return this.snapshots.get(key);
  }

  remember(key: string, snapshot: DirCacheEntry) {
    // Replacing an existing listing also updates its recency.
    const previous = this.snapshots.get(key);
    this.snapshots.delete(key);
    // Oversized listings can still be displayed without displacing the cache.
    if (snapshot.entries.length > this.maxEntries) return;
    this.snapshots.set(key, snapshot);
    if (previous === snapshot) return;

    let entryCount = 0;
    for (const saved of this.snapshots.values()) {
      entryCount += saved.entries.length;
    }

    for (const [oldestKey, oldest] of this.snapshots) {
      if (this.snapshots.size <= this.maxSnapshots && entryCount <= this.maxEntries) break;
      this.snapshots.delete(oldestKey);
      entryCount -= oldest.entries.length;
    }
  }
}
