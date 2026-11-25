import assert from "node:assert/strict";
import test from "node:test";
import { getParentPath } from "../src/lib/paths.ts";

test("Undo resolves drive-root children to an absolute destination", () => {
  for (const path of ["c:/Report.txt", "C:\\Folder\\", "C:\\"]) {
    assert.equal(getParentPath(path), "C:\\");
  }
  assert.equal(getParentPath("\\\\?\\c:\\Report.txt"), "\\\\?\\C:\\");
  assert.equal(getParentPath("C:\\Work\\Report.txt"), "C:\\Work");
  assert.equal(getParentPath("C:"), null);
  assert.equal(getParentPath("C:Work\\Report.txt"), null);
});

test("Undo keeps a UNC share as the root", () => {
  for (const root of ["\\\\server\\Share", "\\\\?\\UNC\\server\\Share"]) {
    assert.equal(getParentPath(root + "\\Report.txt"), root);
    assert.equal(getParentPath(root + "\\"), root);
    assert.equal(getParentPath(root + "\\Work\\Report.txt"), root + "\\Work");
  }
});

test("volume GUID paths keep the root separator for parent destinations", () => {
  const root = "\\\\?\\Volume{8fd2b351-7262-4799-907c-17334e096365}\\";
  assert.equal(getParentPath(root), root);
  assert.equal(getParentPath(root + "Folder"), root);
  assert.equal(getParentPath(root + "Folder\\Child"), root + "Folder");
});
