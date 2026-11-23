import assert from "node:assert/strict";
import test from "node:test";
import { createMoveDestinationGuard } from "../src/lib/moveDestination.ts";

test("move choices reject the source folder and its descendants", () => {
  const isDisabled = createMoveDestinationGuard(["E:\\Originals\\Photos", "E:\\Originals\\notes.txt"]);
  assert.equal(isDisabled("e:\\originals\\"), true);
  assert.equal(isDisabled("\\\\?\\E:\\Originals\\Photos"), true);
  assert.equal(isDisabled("E:\\Originals\\Photos\\Nested"), true);
  assert.equal(isDisabled("E:\\Originals\\Photos-old"), false);
  assert.equal(isDisabled("D:\\Exports"), false);
});

test("move choices cannot overwrite an ancestor that contains a selected item", () => {
  const isDisabled = createMoveDestinationGuard(["E:\\Work\\Project\\Project"]);
  assert.equal(isDisabled("E:\\Work"), true);
  assert.equal(isDisabled("E:\\"), false);
});
