import test from "node:test";
import assert from "node:assert/strict";
import { coercePaneLink, getLinkedPaneFolder, relativeLinkedPath } from "../src/lib/paneLink.ts";

test("linked panes follow matching relative paths in both directions", () => {
  const link = coercePaneLink({
    mainTabId: "originals",
    mainRootPath: "e:\\Originals",
    bottomTabId: "exports",
    bottomRootPath: "\\\\server\\share\\Exports",
  });
  assert.ok(link);
  assert.equal(getLinkedPaneFolder(link, "main", "E:\\Originals\\March\\Photos"), "\\\\server\\share\\Exports\\March\\Photos");
  assert.equal(getLinkedPaneFolder(link, "bottom", "\\\\server\\share\\Exports\\March"), "e:\\Originals\\March");
  assert.equal(getLinkedPaneFolder(link, "bottom", link.bottomRootPath), link.mainRootPath);
  assert.equal(getLinkedPaneFolder(link, "main", "E:\\OriginalsOld\\March"), null);
});

test("linked roots handle Windows volume aliases and reject ambiguous relative paths", () => {
  assert.equal(relativeLinkedPath("D:\\", "\\\\?\\d:\\March"), "March");
  assert.equal(relativeLinkedPath("\\\\server\\share", "\\\\?\\UNC\\server\\share\\March"), "March");
  assert.equal(relativeLinkedPath("D:", "D:\\March"), null);
  assert.equal(relativeLinkedPath("D:\\Originals", "D:\\Originals\\.. \\April"), null);
  assert.equal(relativeLinkedPath("D:\\safe", "D:\\Safe\\April"), null);
  assert.equal(coercePaneLink({ mainTabId: "a", bottomTabId: "b", mainRootPath: "D:relative", bottomRootPath: "E:\\Exports" }), null);
});
