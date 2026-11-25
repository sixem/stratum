import assert from "node:assert/strict";
import test from "node:test";
import { updateIndexedCopySelection } from "../src/components/overlay/indexedSearchModal/indexedCopySelection.ts";

const results = ["Photo.jpg", "Report.xlsx", "Source", "Video.mp4"]
  .map((name) => ({ path: `E:\\Project\\${name}` }));
const [photo, report, source, video] = results.map(({ path }) => path);
const indexes = new Map(results.map(({ path }, index) => [path, index]));

test("Ctrl-click toggles the copied rows independently of focus", () => {
  let selection = updateIndexedCopySelection(null, photo, source, results, indexes, { toggle: true });
  assert.deepEqual(selection.paths, new Set([source, photo]));
  selection = updateIndexedCopySelection(selection, source, photo, results, indexes, { toggle: true });
  assert.deepEqual(selection.paths, new Set([photo]));
});

test("Shift-click selects every displayed result between either end of the range", () => {
  let selection = updateIndexedCopySelection(null, photo, video, results, indexes, { range: true });
  assert.equal(selection.anchor, video);
  assert.deepEqual([...selection.paths], [photo, report, source, video]);
  selection = updateIndexedCopySelection(selection, source, photo, results, indexes, { range: true });
  assert.equal(selection.anchor, video);
  assert.deepEqual([...selection.paths], [source, video]);
});
