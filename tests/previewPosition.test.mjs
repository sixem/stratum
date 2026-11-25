import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewPositionLookup } from "../src/components/preview/previewPosition.ts";

test("gallery navigation resolves exact paths before normalized aliases", () => {
  const items = ["C:/Album/Other.jpg", "C:/Album/photo.jpg", "C:/Album/Photo.jpg", "C:/Album/Last.jpg"]
    .map(path => ({ path }));
  const locate = createPreviewPositionLookup(items);

  assert.equal(locate(items[2].path), 2);
  assert.equal(locate(items[0].path), 0);
  assert.equal(locate("c:\\album\\PHOTO.JPG"), 1);
  assert.equal(locate("C:/Album/Missing.jpg"), -1);
  assert.equal(locate(""), -1);
});
