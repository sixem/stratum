// Give each written file time for its size and timestamp to settle.
const CHECK_DELAYS_MS = [1000, 2000, 4000];

type WriteCheck = { step: number; dueAt: number };

export class FileWriteChecks {
  private readonly pending = new Map<string, WriteCheck>();

  schedule(paths: readonly string[], now: number) {
    for (const path of paths) {
      this.pending.set(path, { step: 0, dueAt: now + CHECK_DELAYS_MS[0] });
    }
  }

  get nextDueAt(): number | null {
    let earliest = Infinity;
    for (const { dueAt } of this.pending.values()) earliest = Math.min(earliest, dueAt);
    return Number.isFinite(earliest) ? earliest : null;
  }

  takeDue(now: number): string[] {
    const paths: string[] = [];
    for (const [path, check] of this.pending) {
      if (check.dueAt > now) continue;
      paths.push(path);
      check.step += 1;
      const delay = CHECK_DELAYS_MS[check.step];
      if (delay === undefined) this.pending.delete(path);
      else check.dueAt = now + delay;
    }
    return paths;
  }
}
