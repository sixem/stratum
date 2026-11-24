import assert from "node:assert/strict";
import test from "node:test";
import { applyContextMenuVisibility, coerceHiddenContextMenuActions } from "../src/lib/contextMenuVisibility.ts";

const item = (id) => ({ id, label: id, onSelect() {} });
const separator = (id) => ({ id, kind: "divider" });

test("visibility settings share an action across menu surfaces", () => {
  const ids = ["entry-cut", "entry-copy", "entry-paste", "layout-paste", "entry-open-other-pane", "windows-menu"];
  const hidden = coerceHiddenContextMenuActions(["cut", "paste", "cut", "open-pane", "unknown", 12]);
  assert.deepEqual(hidden, ["cut", "paste", "open-pane"]);
  assert.deepEqual(applyContextMenuVisibility(ids.map(item), hidden).map(({ id }) => id), ["entry-copy", "windows-menu"]);
  assert.deepEqual(coerceHiddenContextMenuActions(undefined), []);
});

test("hiding a menu group leaves separators only between visible items", () => {
  const menu = [
    item("entry-open"),
    separator("opening"),
    item("entry-copy"),
    separator("clipboard"),
    item("entry-properties"),
    separator("properties"),
  ];
  const visible = (hidden) => applyContextMenuVisibility(menu, hidden).map(({ id }) => id);
  assert.deepEqual(visible(["copy"]), ["entry-open", "opening", "entry-properties"]);
  assert.deepEqual(visible(["open", "properties"]), ["entry-copy"]);
  assert.deepEqual(visible(["open", "copy", "properties"]), []);
});
