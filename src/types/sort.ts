export type SortKey = "name" | "size" | "modified";
export type SortDir = "asc" | "desc";

export type SortState = {
  key: SortKey;
  dir: SortDir;
};
