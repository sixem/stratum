import assert from "node:assert/strict";
import test from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { showShellContextMenu } from "../src/api/shellContextMenu.ts";
import { resolveContextTargets } from "../src/hooks/ui/menus/entryMenu/shared.ts";
import { getKeyboardMenuRequest } from "../src/hooks/ui/menus/keyboardContextMenu.ts";

test("Shell IPC scales client coordinates once and distinguishes items from folder backgrounds", async (t) => {
  globalThis.window = { devicePixelRatio: 1.5, crypto: globalThis.crypto };
  t.after(() => { clearMocks(); delete globalThis.window; });
  const calls = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, ...args });
    return args.offerGallery ? "gallery" : args.extended ? "invoked" : "dismissed";
  });
  const point = { x: 55, y: 14.5 };
  const options = { cmd: "show_shell_context_menu", x: 83, y: 22 };
  const paths = ["Q:\\Test Folder\\a.txt", "Q:\\Test Folder\\B.txt"];
  const mediaPaths = ["Q:\\Test Folder\\photo.png"];
  assert.equal(await showShellContextMenu({ paths }, point, true, false), "invoked");
  assert.equal(await showShellContextMenu({ backgroundPath: "Q:\\" }, point, false, false), "dismissed");
  assert.equal(await showShellContextMenu({ paths: mediaPaths }, point, true, true), "gallery");
  assert.deepEqual(calls, [
    { ...options, paths, backgroundPath: null, extended: true, offerGallery: false },
    { ...options, paths: [], backgroundPath: "Q:\\", extended: false, offerGallery: false },
    { ...options, paths: mediaPaths, backgroundPath: null, extended: true, offerGallery: true },
  ]);
});

test("right-click preserves a multi-selection only when the clicked item is part of it", () => {
  const selected = new Set(["Q:\\", "Q:\\File", "Q:\\file"]);
  const targets = (path) => resolveContextTargets({ path }, selected, "Q:\\");
  assert.deepEqual(targets("Q:\\File"), ["Q:\\File", "Q:\\file"]);
  assert.deepEqual(targets("Q:\\other"), ["Q:\\other"]);
});

test("keyboard uses the current selection after arrow navigation, even if focus stays on another row", (t) => {
  const oldRow = { dataset: { path: "old" }, closest() { return this; } };
  globalThis.document = { activeElement: oldRow };
  globalThis.CSS = { escape: (path) => path };
  t.after(() => { delete globalThis.document; delete globalThis.CSS; });
  const main = {
    contains: (element) => element === oldRow,
    getBoundingClientRect: () => ({ left: 100, top: 100, bottom: 180 }),
    querySelector: (selector) => {
      assert.match(selector, /data-path="new"/);
      return { getBoundingClientRect: () => ({ left: 110, top: 155, bottom: 195 }) };
    },
  };
  assert.deepEqual(getKeyboardMenuRequest(main, "folder", ["new", "other"], null), {
    target: { paths: ["new", "other"] }, point: { x: 114, y: 176 },
  });
  globalThis.document.activeElement = null;
  assert.deepEqual(getKeyboardMenuRequest(main, "folder", [], null), {
    target: { backgroundPath: "folder" }, point: { x: 108, y: 108 },
  });
  assert.equal(getKeyboardMenuRequest(main, "", [], null), null);
});

test("a focused sidebar place keeps its own menu and name when file rows are selected", (t) => {
  const place = {
    dataset: { path: "Q:\\target", contextPlace: "sidebar-recent", contextName: "Recent folder" },
    getBoundingClientRect: () => ({ left: 20, bottom: 90 }),
  };
  globalThis.document = { activeElement: { closest: () => place } };
  t.after(() => { delete globalThis.document; });
  const request = getKeyboardMenuRequest({ contains: () => false }, "Q:\\", ["Q:\\other"], null);
  assert.deepEqual(request, {
    target: { paths: ["Q:\\target"] },
    place: { path: "Q:\\target", name: "Recent folder", source: "sidebar-recent" },
    point: { x: 20, y: 90 },
  });
});
