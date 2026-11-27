import test from "node:test";
import assert from "node:assert/strict";
import { remoteDragAction } from "../src/components/remote/remoteDragFeedback.ts";

const keys = { ctrlKey: false, shiftKey: false, altKey: false };
const local = { kind: "pane", path: "C:\\Downloads", pane: "main" };
const remote = { kind: "remote-entry", path: "/home/data", pane: "bottom" };

test("remote drag feedback matches the local download modifiers", () => {
  assert.equal(remoteDragAction(local, keys), "copy");
  assert.equal(remoteDragAction(local, { ...keys, shiftKey: true }), "move");
  assert.equal(remoteDragAction(local, { ...keys, ctrlKey: true }), "copy");
  assert.equal(remoteDragAction(local, { ...keys, altKey: true }), "unavailable");
});

test("remote destinations use Ctrl to copy and otherwise move", () => {
  assert.equal(remoteDragAction(remote, keys), "move");
  assert.equal(remoteDragAction(remote, { ...keys, ctrlKey: true }), "copy");
  assert.equal(remoteDragAction(remote, { ...keys, altKey: true }), "unavailable");
});

test("tabs use their corresponding local or remote transfer rules", () => {
  assert.equal(remoteDragAction({ kind: "tab", path: "C:\\Downloads" }, { ...keys, shiftKey: true }), "move");
  assert.equal(remoteDragAction({ kind: "remote-tab", path: "/home" }, { ...keys, ctrlKey: true }), "copy");
  assert.equal(remoteDragAction({ kind: "remote-crumb", path: "/home" }, keys), "move");
  assert.equal(remoteDragAction({ kind: "remote-crumb", path: "/home" }, { ...keys, ctrlKey: true }), "copy");
  assert.equal(remoteDragAction({ kind: "remote-tab", path: "/home" }, { ...keys, altKey: true }), "unavailable");
  assert.equal(remoteDragAction({ kind: "tab", path: "C:\\Downloads" }, { ...keys, altKey: true }), "unavailable");
  assert.equal(remoteDragAction(null, keys), "unavailable");
  assert.equal(remoteDragAction({ kind: "tab-submenu" }, keys), "unavailable");
});
