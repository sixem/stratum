import assert from "node:assert/strict";
import test from "node:test";
import { getDropTargetFromPoint } from "../src/lib/dropTarget.ts";
import { formatDate } from "../src/lib/format.ts";

test("a drop uses the tab, directory or pane under the pointer", t => {
  // Model the ancestors of the release point, including a stale row during navigation.
  const pane = { dataset: { panePath: "E:\\Target", filePane: "bottom" } };
  const entry = { dataset: { path: "E:\\Target\\Nested" } };
  const tab = { dataset: { dropPath: "E:\\Other", dropId: "inactive" } };
  const ancestors = new Map();
  const leaf = { closest: selector => ancestors.get(selector) ?? null };
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { elementFromPoint: () => leaf } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete globalThis.document;
  });

  const hit = () => getDropTargetFromPoint(10, 20);
  assert.equal(hit(), null);
  ancestors.set("[data-pane-path]", pane);
  assert.deepEqual(hit(), { kind: "pane", path: pane.dataset.panePath, pane: "bottom" });
  ancestors.set('[data-is-dir="true"][data-path]', entry);
  assert.deepEqual(hit(), { kind: "entry", path: entry.dataset.path, pane: "bottom" });
  pane.dataset.panePath = "";
  assert.equal(hit(), null);
  ancestors.set('[data-drop-kind="tab"][data-drop-path]', tab);
  assert.deepEqual(hit(), { kind: "tab", path: tab.dataset.dropPath, tabId: "inactive" });
  const submenu = { dataset: { dropSubmenuTabId: "inactive" } };
  ancestors.set("[data-drop-submenu-tab-id]", submenu);
  assert.deepEqual(hit(), { kind: "tab-submenu", tabId: "inactive" });
  const subfolder = { dataset: { dropPath: "E:\\Other\\Child", dropTabId: "inactive" } };
  ancestors.set('[data-drop-kind="tab-subfolder"][data-drop-path]', subfolder);
  assert.deepEqual(hit(), { kind: "tab-subfolder", path: subfolder.dataset.dropPath, tabId: "inactive" });
});

test("file dates use a 00–23 clock at midnight and in the afternoon", () => {
  const digits = new Intl.NumberFormat(undefined, { minimumIntegerDigits: 2 });
  const formatted = hour => formatDate(new Date(2026, 10, 19, hour, 7).getTime());
  for (const hour of [0, 13]) assert.ok(formatted(hour).includes(digits.format(hour)));
  assert.doesNotMatch(formatted(13), /\b[AP]M\b/i);
});
