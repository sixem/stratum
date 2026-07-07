// Shared types and tiny normalizers for the indexed-search modal.
//
// Keeping these helpers in one file makes selection comparisons consistent
// across hooks and presentational components.
export type IndexedSelection =
  | { kind: "drive"; drivePath: string }
  | { kind: "result"; path: string };

export const normalizeDrivePathKey = (value: string | null | undefined) =>
  value?.trim().replace(/\//g, "\\").toLowerCase() ?? "";

export const normalizeIndexedPathKey = (value: string | null | undefined) =>
  value?.trim().replace(/\//g, "\\").toLowerCase() ?? "";
