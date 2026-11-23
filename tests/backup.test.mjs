import test from "node:test";
import assert from "node:assert/strict";
import { listBackupLocations, remapBackupLocations } from "../src/modules/backup/layoutPaths.ts";
import { createBackupPathRemapper, parseBackupLocation } from "../src/modules/backup/locations.ts";
import { writeBackupRecords } from "../src/modules/backup/persistence.ts";
import { coerceQuickMovePreferences } from "../src/modules/quickMovePreferences.ts";

test("backup remaps choose the deepest folder prefix and preserve other locations", () => {
  const map = createBackupPathRemapper([
    { from: "d:\\", to: "F:\\Archive" },
    { from: "D:\\Work", to: "G:\\Projects" },
  ]);
  assert.equal(map("\\\\?\\D:\\Work\\March"), "G:\\Projects\\March");
  assert.equal(map("D:\\WorkOld\\March"), "F:\\Archive\\WorkOld\\March");
  assert.equal(map("D:\\work"), "F:\\Archive\\work");
  assert.equal(map("C:\\Work"), "C:\\Work");
  assert.equal(map("D:Work"), "D:Work");
  assert.equal(parseBackupLocation("\\\\?\\UNC\\server\\share").localSyntax, false);
});

test("a failed backup import rolls back replaced and newly written records", () => {
  const entries = new Map([["workspaces", "old layout"], ["pane", "old pane"]]);
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      if (key === "pane") throw new Error("Storage quota exceeded");
      entries.set(key, value);
    },
    removeItem: (key) => entries.delete(key),
  };
  assert.throws(
    () => writeBackupRecords([["workspaces", "imported layout"], ["settings", "preferences"], ["pane", "imported pane"]], storage),
    /Couldn't save the imported backup/,
  );
  assert.deepEqual(entries, new Map([["workspaces", "old layout"], ["pane", "old pane"]]));
});

test("Quick Move filters preserve all, none, and explicit depth through JSON", () => {
  const picker = (data) => coerceQuickMovePreferences(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(picker({}), { favorites: [], driveRoots: null, maxDepth: null });
  assert.deepEqual(picker({ driveRoots: [], maxDepth: 0 }), { favorites: [], driveRoots: [], maxDepth: 0 });
  assert.deepEqual(picker({
    favorites: ["d:\\Work", "D:\\Work\\", "D:\\work", "", "\0"],
    driveRoots: ["d:", "\\\\?\\D:\\", "E:\\", "D:relative"],
    maxDepth: -1,
  }), { favorites: ["d:\\Work", "D:\\work"], driveRoots: ["D:\\", "E:\\"], maxDepth: null });
});

test("workspace backup remaps Quick Move favorites and drive filters", () => {
  const session = { tabs: [], activeTabId: null, recentJumps: [] };
  const layout = { main: session, bottom: session, pane: { link: null }, places: { places: [] } };
  const backup = {
    scope: "workspaces",
    workspaces: [
      { id: "first", name: "First", layout, recentMoves: [], quickMove: {
        favorites: ["D:\\Projects", "F:\\Other"], driveRoots: ["D:\\", "F:\\"], maxDepth: 2,
      } },
      { id: "second", name: "Second", layout, recentMoves: [], quickMove: {
        favorites: [], driveRoots: [], maxDepth: null,
      } },
      { id: "old", name: "Old", layout, recentMoves: [] },
    ],
  };
  assert.deepEqual(listBackupLocations(backup), ["D:\\Projects", "F:\\Other", "D:\\", "F:\\"]);
  const imported = remapBackupLocations(backup, [{ from: "D:\\", to: "F:\\Archive" }]);
  assert.deepEqual(imported.workspaces.map(({ quickMove }) => quickMove), [
    { favorites: ["F:\\Archive\\Projects", "F:\\Other"], driveRoots: ["F:\\"], maxDepth: 2 },
    { favorites: [], driveRoots: [], maxDepth: null },
    undefined,
  ]);
});
