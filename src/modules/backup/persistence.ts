// Make the portable records durable before applying their stores to the live window.
export type BackupStorageRecord = readonly [key: string, value: string];

export const writeBackupRecords = (records: readonly BackupStorageRecord[], storage = globalThis.localStorage) => {
  const written: [key: string, previous: string | null][] = [];
  try {
    for (const [key, value] of records) {
      const previous = storage.getItem(key);
      if (previous === value) continue;
      storage.setItem(key, value);
      written.push([key, previous]);
    }
  } catch {
    // Roll back strings already written if the profile runs out of space.
    for (const [key, previous] of written.reverse()) {
      if (previous === null) storage.removeItem(key);
      else storage.setItem(key, previous);
    }
    throw new Error("Couldn't save the imported backup. Check the available app storage and try again.");
  }
};
