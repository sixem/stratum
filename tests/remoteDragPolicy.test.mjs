import test from "node:test";
import assert from "node:assert/strict";
import { resolveRemoteDragTarget } from "../src/components/remote/remoteDragPolicy.ts";

const source = { pane: "main", profileId: "host-a", sessionId: 1, parent: "/home/work",
  entries: [{ path: "/home/work/file.txt", isDir: false }, { path: "/home/work/tree", isDir: true }] };
const location = { kind: "remote", profileId: "host-a", sessionId: 1, path: "/home/work" };
const plain = { ctrlKey: false, altKey: false };
const crumb = path => ({ kind: "remote-crumb", pane: "main", profileId: "host-a", sessionId: 1, path });

test("remote breadcrumb drops accept ancestors while rejecting self, descendants and stale hosts", () => {
  assert.deepEqual(resolveRemoteDragTarget(crumb("/home"), source, location, plain), crumb("/home"));
  assert.deepEqual(resolveRemoteDragTarget(crumb("/"), source, location, { ...plain, ctrlKey: true }), crumb("/"));
  assert.equal(resolveRemoteDragTarget(crumb("/home/work"), source, location, plain), null);
  assert.equal(resolveRemoteDragTarget(crumb("/home/work/tree/sub"), source, location, plain), null);
  assert.equal(resolveRemoteDragTarget(crumb("/home"), source, { ...location, profileId: "host-b" }, plain), null);
  assert.equal(resolveRemoteDragTarget(crumb("/home"), source, { ...location, sessionId: 2 }, plain), null);
  assert.equal(resolveRemoteDragTarget(crumb("/home"), source, location, { ...plain, altKey: true }), null);
});

test("remote drags can target another pane, a different tab, or a local sidebar place", () => {
  const otherPane = { kind: "remote-pane", pane: "bottom", path: "/destination" };
  const destination = { ...location, path: "/destination" };
  assert.deepEqual(resolveRemoteDragTarget(otherPane, source, destination, plain), otherPane);
  assert.equal(resolveRemoteDragTarget(otherPane, source, { ...destination, path: "/stale" }, plain), null);
  assert.equal(resolveRemoteDragTarget({ ...otherPane, path: source.parent }, source, location, plain), null);
  const sidebar = { kind: "entry", path: "C:\\Downloads" };
  assert.deepEqual(resolveRemoteDragTarget(sidebar, source, undefined, plain), sidebar);
  assert.equal(resolveRemoteDragTarget({ kind: "pane", pane: "main", path: "C:\\Downloads" }, source, { kind: "local", path: "C:\\Downloads" }, plain), null);
  const remoteTab = { kind: "remote-tab", profileId: "host-a", path: "/home/work/tree/sub" };
  assert.equal(resolveRemoteDragTarget(remoteTab, source, undefined, plain), null);
  assert.deepEqual(resolveRemoteDragTarget({ ...remoteTab, profileId: "host-b" }, source, undefined, plain), { ...remoteTab, profileId: "host-b" });
});

test("symbolic links only accept moves on their own host", () => {
  const link = { ...source, entries: [{ path: "/home/work/link", isDir: true, isSymlink: true }] };
  assert.deepEqual(resolveRemoteDragTarget(crumb("/home"), link, location, plain), crumb("/home"));
  assert.equal(resolveRemoteDragTarget(crumb("/home"), link, location, { ...plain, ctrlKey: true }), null);
  assert.equal(resolveRemoteDragTarget({ kind: "entry", path: "C:\\Downloads" }, link, undefined, plain), null);
  assert.equal(resolveRemoteDragTarget({ kind: "remote-tab", profileId: "host-b", path: "/other" }, link, undefined, plain), null);
});
