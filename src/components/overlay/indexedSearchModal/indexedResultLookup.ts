// Pages append to one path index per query. An older render can only look up
// rows in its own result array, even after another page has committed.
export function indexedResultLookup(indexes: ReadonlyMap<string, number>, length: number) {
  function get(path: string) {
    const index = indexes.get(path);
    return index !== undefined && index < length ? index : undefined;
  }
  return { get, has: (path: string) => get(path) !== undefined };
}

export type IndexedResultLookup = ReturnType<typeof indexedResultLookup>;
