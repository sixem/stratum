import type { Tab } from "@/types/tabs";

// Remap both the folder shown by a tab and the starting folder of its shell.
export function mapTabLocations(tab: Tab, map: (path: string) => string): Tab {
  if (tab.kind === "terminal") {
    const directory = map(tab.terminal.directory);
    return directory === tab.terminal.directory ? tab : { ...tab, terminal: { ...tab.terminal, directory } };
  }
  const path = map(tab.path);
  const crumbTrailPath = map(tab.crumbTrailPath);
  let split = tab.split;
  if (split) {
    const directory = map(split.terminal.directory);
    if (directory !== split.terminal.directory) split = { ...split, terminal: { ...split.terminal, directory } };
  }
  return path === tab.path && crumbTrailPath === tab.crumbTrailPath && split === tab.split
    ? tab : { ...tab, path, crumbTrailPath, split };
}
