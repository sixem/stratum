// Share the base map across small updates. A single bounded overlay keeps lookup
// cost constant and preserves the values seen by earlier renders.

const MAX_OVERLAY_ENTRIES = 512;

export class PathSnapshot<Value extends NonNullable<unknown>> {
  private readonly base: ReadonlyMap<string, Value>;
  private readonly changes: ReadonlyMap<string, Value>;

  constructor(base: ReadonlyMap<string, Value> = new Map(), changes: ReadonlyMap<string, Value> = new Map()) {
    this.base = base;
    this.changes = changes;
  }

  get(path: string) {
    return this.changes.get(path) ?? this.base.get(path);
  }

  has(path: string) {
    return this.changes.has(path) || this.base.has(path);
  }

  withUpdates(updates: ReadonlyMap<string, Value>): PathSnapshot<Value> {
    let changes: Map<string, Value> | undefined;
    for (const [path, value] of updates) {
      if (this.get(path) === value) continue;
      (changes ??= new Map(this.changes)).set(path, value);
    }
    if (!changes) return this;
    if (changes.size <= MAX_OVERLAY_ENTRIES) return new PathSnapshot(this.base, changes);

    const base = new Map(this.base);
    for (const [path, value] of changes) base.set(path, value);
    return new PathSnapshot(base);
  }
}
