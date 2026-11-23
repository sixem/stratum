// Work with complete Windows path components so a remap never captures a neighboring folder.
type BackupLocation = {
  root: string;
  rootKey: string;
  parts: string[];
  localSyntax: boolean;
};

export type BackupPathMapping = { from: string; to: string };

const invalidComponent = /[\u0000-\u001f<>:"|?*]/;

export const parseBackupLocation = (value: string): BackupLocation | null => {
  if (value.includes("\0")) return null;
  const path = value.trim().replace(/\//g, "\\");
  const local = /^(?:\\\\\?\\)?([a-z]:)\\/i.exec(path)
    ?? /^(\\\\\?\\Volume\{[0-9a-f-]+\})\\/i.exec(path);
  let prefix: string;
  let rootKey: string;
  if (local) {
    [prefix, rootKey] = local;
  } else {
    const unc = /^(?:\\\\\?\\UNC\\|\\\\)([^\\?.][^\\]*)\\([^\\]+)(?:\\|$)/i.exec(path);
    if (!unc || invalidComponent.test(unc[1]) || invalidComponent.test(unc[2])) return null;
    const [sharePrefix, server, share] = unc;
    prefix = sharePrefix;
    rootKey = `\\\\${server}\\${share}`;
  }
  const root = prefix.endsWith("\\") ? prefix : `${prefix}\\`;

  const parts: string[] = [];
  for (const part of path.slice(prefix.length).split("\\")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      if (invalidComponent.test(part)) return null;
      parts.push(part);
    }
  }
  return { root, rootKey: rootKey.toLowerCase(), parts, localSyntax: Boolean(local) };
};

export const backupLocationKey = (path: string): string => {
  const location = parseBackupLocation(path);
  return location ? `${location.rootKey}\\${location.parts.join("\\")}` : "";
};

const hasFolderPrefix = (path: BackupLocation, prefix: BackupLocation) =>
  path.rootKey === prefix.rootKey && path.parts.length >= prefix.parts.length
  && prefix.parts.every((part, index) => part === path.parts[index]);

export const createBackupPathRemapper = (mappings: readonly BackupPathMapping[]) => {
  const rules = mappings.flatMap(({ from, to }) => {
    const source = parseBackupLocation(from);
    const destination = parseBackupLocation(to);
    return source && destination ? [{ source, destination }] : [];
  }).sort((left, right) => right.source.parts.length - left.source.parts.length);

  return (path: string): string => {
    if (!rules.length) return path;
    const location = parseBackupLocation(path);
    if (!location) return path;
    const rule = rules.find(({ source }) => hasFolderPrefix(location, source));
    if (!rule) return path;
    const parts = [...rule.destination.parts, ...location.parts.slice(rule.source.parts.length)];
    return rule.destination.root + parts.join("\\");
  };
};
