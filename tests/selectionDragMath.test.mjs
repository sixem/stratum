import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLayoutSnapshot,
  selectPathsFromLayoutSnapshot,
} from "../src/hooks/ui/selection/selectionDragMath.ts";

test("drag selection checks current job state only for paths it hits", () => {
  const items = Array.from({ length: 50_000 }, (_, index) => ({ path: `file-${index}`, selectable: true }));
  items[0].selectable = false;
  const list = buildLayoutSnapshot({ kind: "list", items, itemHeight: 25, rowHeight: 22 });
  const grid = buildLayoutSnapshot({
    kind: "grid", items, columnCount: 4, columnWidth: 20, columnGap: 5, rowHeight: 25, rowGap: 3,
  }, { clientWidth: 100, paddingLeft: 0, paddingRight: 0, paddingTop: 0, centerGrid: false });
  const pending = new Set(["file-1", "file-42000"]);
  const checked = [];
  const canSelect = (path) => {
    checked.push(path);
    return !pending.has(path);
  };

  const listRect = { left: 0, right: 50, top: 1, bottom: 51 };
  const gridRect = { left: 1, right: 51, top: 1, bottom: 12 };
  for (const [snapshot, rect] of [[list, listRect], [grid, gridRect]]) {
    assert.deepEqual(selectPathsFromLayoutSnapshot(snapshot, rect, canSelect), ["file-2"]);
    assert.deepEqual(checked.splice(0), ["file-1", "file-2"]);
  }

  pending.delete("file-1");
  assert.deepEqual(selectPathsFromLayoutSnapshot(list, listRect, canSelect), ["file-1", "file-2"]);
  assert.deepEqual(checked, ["file-1", "file-2"]);
});
