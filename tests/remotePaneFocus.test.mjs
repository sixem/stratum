import test from "node:test";
import assert from "node:assert/strict";
import { isRemotePaneActive, isRemotePaneShortcutFocus } from "../src/components/remote/remotePaneKeyboard.ts";

// A small ancestor tree exercises the same closest() behavior as focused DOM elements.
class Node {
  constructor({ classes = [], data = {}, parent = null } = {}) {
    this.classes = new Set(classes);
    this.dataset = data;
    this.parent = parent;
  }
  closest(selectors) {
    const match = (node, selector) => {
      if (selector.startsWith(".")) return node.classes.has(selector.slice(1));
      const attribute = /^\[data-([\w-]+)(?:="([^"]+)")?\]$/.exec(selector);
      if (!attribute) return false;
      const key = attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return key in node.dataset && (attribute[2] === undefined || node.dataset[key] === attribute[2]);
    };
    for (let node = this; node; node = node.parent) {
      if (selectors.split(",").some(selector => match(node, selector.trim()))) return node;
    }
    return null;
  }
}

test("remote breadcrumb focus belongs to its pane in both layouts", () => {
  const body = new Node();
  const documentElement = new Node();
  const roots = { body, documentElement };
  const topstack = new Node({ classes: ["topstack"] });
  const mainCrumbs = new Node({ classes: ["main-crumbs"] });
  const bottomPane = new Node({ classes: ["bottom-pane"] });
  for (const parent of [topstack, mainCrumbs]) {
    const bar = new Node({ data: { breadcrumbPane: "main" }, parent });
    const button = new Node({ parent: bar });
    assert.equal(isRemotePaneShortcutFocus("main", button, roots), true);
    assert.equal(isRemotePaneShortcutFocus("bottom", button, roots), false);
    assert.equal(isRemotePaneActive("main", false), true);
    assert.equal(isRemotePaneActive("main", true), false);
  }
  const bottomBar = new Node({ data: { breadcrumbPane: "bottom" }, parent: bottomPane });
  const bottomCrumb = new Node({ parent: bottomBar });
  assert.equal(isRemotePaneShortcutFocus("bottom", bottomCrumb, roots), true);
  assert.equal(isRemotePaneShortcutFocus("main", bottomCrumb, roots), false);
  assert.equal(isRemotePaneActive("bottom", true), true);
  assert.equal(isRemotePaneActive("bottom", false), false);
  assert.equal(isRemotePaneShortcutFocus("main", body, roots), true);
  assert.equal(isRemotePaneShortcutFocus("main", new Node({ classes: ["sidebar"] }), roots), false);
});
