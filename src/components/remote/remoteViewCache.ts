// Bounded in-memory state for returning to remote folders during a session.
export class RemoteViewCache<T> {
  private entries = new Map<string, { value: T; cost: number }>();
  private cost = 0;
  private readonly maxEntries: number;
  private readonly maxCost: number;

  constructor(maxEntries: number, maxCost: number) {
    this.maxEntries = maxEntries;
    this.maxCost = maxCost;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.cost -= entry.cost;
  }

  set(key: string, value: T, cost: number) {
    this.delete(key);
    if (!Number.isFinite(cost) || cost < 0 || cost > this.maxCost) return;
    this.entries.set(key, { value, cost });
    this.cost += cost;
    while (this.entries.size > this.maxEntries || this.cost > this.maxCost) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}

export type RemoteSelectionSnapshot = { paths: string[]; anchor: string | null };
export const remoteSelectionCache = new RemoteViewCache<RemoteSelectionSnapshot>(64, 8 * 1024 * 1024);
export const remoteScrollCache = new RemoteViewCache<number>(128, 128);
