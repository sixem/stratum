// A range can contain the navigation row or paths that disappeared on refresh.
export function selectedRemoteEntries<T>(paths: Iterable<string>, entryByPath: ReadonlyMap<string, T>): T[] {
  const entries: T[] = [];
  for (const path of paths) {
    const entry = entryByPath.get(path);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}
