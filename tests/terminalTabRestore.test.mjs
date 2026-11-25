import assert from "node:assert/strict";
import test from "node:test";
import { mapTabLocations } from "../src/lib/tabLocations.ts";
import { readTabContent, selectRestoredFolder } from "../src/lib/tabRestore.ts";

const terminal = { kind: "terminal", id: "shell", path: "", terminal: { key: "old", directory: "C:\\Work" } };
const split = { kind: "folder", id: "split", path: "C:\\Files", crumbTrailPath: "C:\\Files", split: {
  terminal: terminal.terminal, folderPercent: 60, linkDirectory: true, terminalFirst: true, stacked: true,
} };
const folder = { kind: "folder", id: "folder", path: "C:\\Documents" };
const start = { kind: "folder", id: "start", path: "" };

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
    const restored = selectRestoredFolder({ tabs, activeTabId }, () => assert.fail("A folder already exists"));
    assert.equal(restored.activeTabId, folder.id);
    assert.equal(restored.tabs, tabs);
  }
  assert.deepEqual(selectRestoredFolder({ tabs: [terminal, split], activeTabId: terminal.id }, () => start), {
    tabs: [terminal, split, start], activeTabId: start.id,
  });
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
