import assert from "node:assert/strict";
import test from "node:test";
import { mapTabLocations } from "../src/lib/tabLocations.ts";
import { readTabContent, selectRestoredFolder } from "../src/lib/tabRestore.ts";
import { hasUnreachableShells, isParkedShell, liveShellKeys, parkWorkspaceShells, parkedWorkspaceShells, retainWorkspaceShells } from "../src/modules/workspaceTerminals.ts";

const terminal = { kind: "terminal", id: "shell", path: "", terminal: { key: "old", directory: "C:\\Work" } };
const split = { kind: "folder", id: "split", path: "C:\\Files", crumbTrailPath: "C:\\Files", split: {
  terminal: terminal.terminal, folderPercent: 60, linkDirectory: true, terminalFirst: true, stacked: true,
} };
const folder = { kind: "folder", id: "folder", path: "C:\\Documents" };

test("both terminal tab types reuse the saved layout and derive a fresh shell identity", () => {
  assert.deepEqual(readTabContent(terminal, "new"), {
    kind: "terminal", terminal: { key: "new", directory: "C:\\Work" },
  });
  assert.deepEqual(readTabContent(split, "new"), {
    kind: "folder", split: { ...split.split, terminal: { key: "new", directory: "C:\\Work" } },
  });
  assert.deepEqual(readTabContent({ ...terminal, kind: undefined, anchored: true }, "new"), readTabContent(terminal, "new"));
  assert.deepEqual(readTabContent({ path: "C:\\Documents" }, "new"), { kind: "folder", split: undefined });
  assert.equal(readTabContent({ ...terminal, terminal: { directory: "bad\0path" } }, "new"), null);
});

test("restoring with a terminal selected starts on a plain folder tab", () => {
  const tabs = [terminal, split, folder];
  for (const activeTabId of [terminal.id, split.id, folder.id]) {
    const restored = selectRestoredFolder({ tabs, activeTabId });
    assert.equal(restored.activeTabId, folder.id);
    assert.equal(restored.tabs, tabs);
  }
  assert.deepEqual(selectRestoredFolder({ tabs: [terminal, split], activeTabId: terminal.id }), {
    tabs: [terminal, split], activeTabId: null,
  });
});

test("only a reachable workspace can resume its running standalone and split shells", () => {
  const layout = (first, second) => ({
    main: { tabs: [first] }, bottom: { tabs: [second] },
  });
  const savedSplit = { ...split, split: { ...split.split, terminal: { ...split.split.terminal, key: "saved-bottom" } } };
  const saved = { id: "work", layout: layout(terminal, savedSplit) };
  const main = { ...terminal, terminal: { ...terminal.terminal, key: "live-main" } };
  const bottom = { ...split, split: { ...split.split, terminal: { ...split.split.terminal, key: "live-bottom" } } };
  const previous = { id: saved.id, layout: layout(main, bottom) };
  liveShellKeys.add("live-main");
  liveShellKeys.add("live-bottom");
  try {
    parkWorkspaceShells(previous, saved.layout);
    retainWorkspaceShells([previous, saved]);
    assert.equal(hasUnreachableShells(previous, saved.layout), false);
    assert.equal(hasUnreachableShells(previous), true);
    retainWorkspaceShells([saved]);
    assert.equal(parkedWorkspaceShells("work").get(terminal.terminal), "live-main");
    assert.equal(parkedWorkspaceShells("work").get(saved.layout.bottom.tabs[0].split.terminal), "live-bottom");
    assert.equal(isParkedShell("live-bottom"), true);
    retainWorkspaceShells([{ ...saved, id: "duplicate" }]);
    assert.equal(isParkedShell("live-main"), false);
    assert.equal(isParkedShell("live-bottom"), false);
  } finally {
    retainWorkspaceShells([]);
    liveShellKeys.clear();
  }
});

test("path remaps preserve the tab kind and include both shell starting directories", () => {
  const map = path => path.replace(/^C:/, "E:");
  assert.deepEqual(mapTabLocations(terminal, map).terminal, { key: "old", directory: "E:\\Work" });
  const moved = mapTabLocations(split, map);
  assert.equal(moved.kind, "folder");
  assert.equal(moved.path, "E:\\Files");
  assert.equal(moved.split.terminal.directory, "E:\\Work");
  assert.equal(moved.split.folderPercent, 60);
});
