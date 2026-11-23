// Transform every backed-up workspace location together, including recent paths and links.
import { coerceQuickMovePreferences } from "../quickMovePreferences.ts";
import type { QuickMovePreferences } from "../quickMovePreferences";
import type { SessionState } from "../sessionStore";
import type { WorkspaceLayout } from "../workspaceStore";
import { backupLocationKey, createBackupPathRemapper } from "./locations.ts";
import type { BackupPathMapping } from "./locations";
import type { StratumBackup } from "./types";

type MapPath = (path: string) => string;

const mapSessionPaths = (session: SessionState, map: MapPath): SessionState => ({
  ...session,
  tabs: session.tabs.map((tab) => ({ ...tab, path: map(tab.path), crumbTrailPath: map(tab.crumbTrailPath) })),
  recentJumps: session.recentJumps.map(map),
});

const mapLayoutPaths = (layout: WorkspaceLayout, map: MapPath): WorkspaceLayout => {
  const link = layout.pane.link;
  return {
    main: mapSessionPaths(layout.main, map),
    bottom: mapSessionPaths(layout.bottom, map),
    pane: link ? {
      ...layout.pane,
      link: { ...link, mainRootPath: map(link.mainRootPath), bottomRootPath: map(link.bottomRootPath) },
    } : layout.pane,
    places: { ...layout.places, places: layout.places.places.map((place) => ({ ...place, path: map(place.path) })) },
  };
};

const mapQuickMovePaths = (picker: QuickMovePreferences | undefined, map: MapPath) => picker && coerceQuickMovePreferences({
  ...picker,
  favorites: picker.favorites.map(map),
  driveRoots: picker.driveRoots?.map(map) ?? null,
});

const mapBackupPaths = (backup: StratumBackup, map: MapPath): StratumBackup => {
  const workspaces = backup.workspaces.map((entry) => ({
    ...entry,
    layout: mapLayoutPaths(entry.layout, map),
    draft: entry.draft ? mapLayoutPaths(entry.draft, map) : undefined,
    recentMoves: entry.recentMoves.map(map),
    quickMove: mapQuickMovePaths(entry.quickMove, map),
  }));
  if (backup.scope === "workspaces") return { ...backup, workspaces };
  const { profile } = backup;
  return {
    ...backup,
    workspaces,
    profile: {
      ...profile,
      current: { ...profile.current, layout: mapLayoutPaths(profile.current.layout, map) },
      previous: profile.previous && { ...profile.previous, layout: mapLayoutPaths(profile.previous.layout, map) },
      unnamedRecentMoves: profile.unnamedRecentMoves.map(map),
      unnamedQuickMove: mapQuickMovePaths(profile.unnamedQuickMove, map),
    },
  };
};

export const listBackupLocations = (backup: StratumBackup): string[] => {
  const locations = new Map<string, string>();
  mapBackupPaths(backup, (path) => {
    const key = backupLocationKey(path);
    if (key && !locations.has(key)) locations.set(key, path);
    return path;
  });
  return [...locations.values()];
};

export const remapBackupLocations = (backup: StratumBackup, mappings: readonly BackupPathMapping[]): StratumBackup =>
  mappings.length ? mapBackupPaths(backup, createBackupPathRemapper(mappings)) : backup;
