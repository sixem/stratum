// Share the directory listing across small metadata updates. Bound the overlay
// so scrolling through new rows never builds a chain of lookups.
import type { EntryMeta, EntryMetaLookup } from "@/types";

const MAX_OVERLAY_ENTRIES = 512;

export class EntryMetaSnapshot implements EntryMetaLookup {
  private readonly listing: ReadonlyMap<string, EntryMeta>;
  private readonly changes: ReadonlyMap<string, EntryMeta>;

  constructor(listing: ReadonlyMap<string, EntryMeta> = new Map(), changes: ReadonlyMap<string, EntryMeta> = new Map()) {
    this.listing = listing;
    this.changes = changes;
  }

  get(path: string) {
    return this.changes.get(path) ?? this.listing.get(path);
  }

  has(path: string) {
    return this.changes.has(path) || this.listing.has(path);
  }

  withUpdates(updates: ReadonlyMap<string, EntryMeta>): EntryMetaSnapshot {
    const changes = new Map(this.changes);
    for (const [path, meta] of updates) changes.set(path, meta);
    if (changes.size <= MAX_OVERLAY_ENTRIES) return new EntryMetaSnapshot(this.listing, changes);

    const listing = new Map(this.listing);
    for (const [path, meta] of changes) listing.set(path, meta);
    return new EntryMetaSnapshot(listing);
  }
}
