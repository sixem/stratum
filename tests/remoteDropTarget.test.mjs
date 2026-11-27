import assert from "node:assert/strict";
import test from "node:test";
import { getDropTargetHit } from "../src/lib/dropTarget.ts";

function remoteHit(directory) {
  const pane = { dataset: { filePane: "bottom" }, contains: () => true };
  const folder = { dataset: { remoteFolderPath: "/canonical/folder" } };
  const element = { closest(selector) {
    if (selector === "[data-pane-path]") return pane;
    if (selector === ".remote-folder[data-remote-folder-path]") return folder;
    if (selector === '[data-is-dir="true"][data-remote-path]') return directory;
    return null;
  } };
  globalThis.document = { elementFromPoint: () => element };
  return getDropTargetHit(1, 1);
}

test("remote folder drops use the displayed canonical directory", () => {
  assert.deepEqual(remoteHit(null).target, { kind: "remote-pane", pane: "bottom", path: "/canonical/folder" });
  assert.deepEqual(remoteHit({ dataset: { remotePath: "/canonical/folder/child" } }).target,
    { kind: "remote-entry", pane: "bottom", path: "/canonical/folder/child" });
});

test("dropping on a remote directory link is rejected instead of targeting its parent", () => {
  const link = { dataset: { remotePath: "/canonical/folder/link", remoteSymlink: "true" } };
  assert.deepEqual(remoteHit(link), { target: null, element: link });
});

test("remote tabs retain their host and destination path", () => {
  const tab = { dataset: { dropPath: "/home/user", dropProfile: "host-id", dropId: "tab-id" } };
  const element = { closest(selector) { return selector === '[data-drop-kind="remote-tab"][data-drop-path][data-drop-profile]' ? tab : null; } };
  globalThis.document = { elementFromPoint: () => element };
  assert.deepEqual(getDropTargetHit(1, 1).target, { kind: "remote-tab", path: "/home/user", profileId: "host-id", tabId: "tab-id" });
});
