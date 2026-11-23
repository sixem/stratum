// Decide which imported names can be used directly and which need a fresh copy.
import type { Workspace } from "../workspaceStore";
import type { BackupWorkspace } from "./types";

export type BackupConflictPolicy = "copies" | "replace";

export const makeImportedName = (name: string, taken: Set<string>): string => {
  let candidate = `${name} (imported)`;
  let suffix = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${name} (imported ${suffix})`;
    suffix += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
};

export const planBackupWorkspaceNames = (
  incoming: readonly BackupWorkspace[],
  existing: readonly Workspace[],
  policy: BackupConflictPolicy,
) => {
  const existingNames = new Map(existing.map(({ id, name }) => [name.toLowerCase(), id]));
  // A generated copy name cannot take another incoming workspace's real name.
  const taken = new Set([...existingNames.keys(), ...incoming.map(({ name }) => name.toLowerCase())]);
  return incoming.map((workspace) => {
    const existingId = existingNames.get(workspace.name.toLowerCase());
    return {
      workspace,
      name: existingId && policy === "copies" ? makeImportedName(workspace.name, taken) : workspace.name,
      replacingId: policy === "replace" ? existingId : undefined,
    };
  });
};
