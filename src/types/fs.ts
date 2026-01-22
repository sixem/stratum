export type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
  modified: number | null;
};

export type Place = {
  name: string;
  path: string;
};

export type EntryMeta = {
  path: string;
  size: number | null;
  modified: number | null;
};

export type DriveInfo = {
  path: string;
  free: number | null;
  total: number | null;
};

export type CopyReport = {
  copied: number;
  skipped: number;
  failures: string[];
};

export type DeleteReport = {
  deleted: number;
  skipped: number;
  failures: string[];
};
