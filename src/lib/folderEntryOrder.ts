// Retained rows use the same order as their directory listing. Local listings
// come from fs_list/sort.rs, while SFTP listings use the user's locale.
import type { FileEntry, SortState } from "@/types";

const remoteNames = new Intl.Collator(undefined, { numeric: true });
const maxU64 = (1n << 64n) - 1n;

// Rust compares UTF-8 strings by Unicode scalar value. JS compares UTF-16 units.
function compareText(left: string, right: string) {
  let i = 0;
  while (i < left.length && i < right.length) {
    const a = left.codePointAt(i)!;
    const b = right.codePointAt(i)!;
    if (a !== b) return a - b;
    i += a > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}

function compareDigits(left: string, right: string) {
  const a = BigInt(left), b = BigInt(right);
  if (a <= maxU64 && b <= maxU64) {
    if (a !== b) return a < b ? -1 : 1;
  } else if (a <= maxU64 || b <= maxU64) {
    return a <= maxU64 ? -1 : 1;
  }
  return left.length - right.length || compareText(left, right);
}

function compareLocalNames(left: string, right: string) {
  const a = left.toLowerCase().match(/[0-9]+|[^0-9]+/gu) ?? [];
  const b = right.toLowerCase().match(/[0-9]+|[^0-9]+/gu) ?? [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    return /^[0-9]/.test(a[i]) && /^[0-9]/.test(b[i])
      ? compareDigits(a[i], b[i]) : compareText(a[i], b[i]);
  }
  return a.length - b.length || compareText(left, right);
}

export function compareFolderEntries(a: FileEntry, b: FileEntry, sort: SortState, remote: boolean) {
  // Resolving an SFTP link for navigation does not change its listing group.
  const aFolder = a.isDir && !(remote && a.isSymlink);
  const bFolder = b.isDir && !(remote && b.isSymlink);
  if (aFolder !== bFolder) return aFolder ? -1 : 1;

  const direction = sort.dir === "asc" ? 1 : -1;
  if (sort.key !== "name") {
    const left = a[sort.key], right = b[sort.key];
    if (left !== right) {
      // SFTP keeps missing metadata last in both directions.
      if (left === null) return remote ? 1 : direction;
      if (right === null) return remote ? -1 : -direction;
      return (left - right) * direction;
    }
  }
  const names = remote ? remoteNames.compare(a.name, b.name) : compareLocalNames(a.name, b.name);
  return sort.key === "name" ? names * direction : names;
}
