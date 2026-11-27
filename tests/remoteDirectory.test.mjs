import assert from "node:assert/strict";
import test from "node:test";
import { remoteCrumbs, remoteParent, displayRemoteEntries, canBrowseEntry, canPreviewRemote, canPreviewRemoteVideo } from "../src/components/remote/remoteDirectory.ts";

const row = (name, size = 100, isDir = false) => ({ name, size, isDir, path: "/" + name, modified: 0 });

test("remote breadcrumbs preserve exact components, including backslashes, spaces and case", () => {
  const path = "/srv/App/a\\b/ trailing ";
  assert.deepEqual(remoteCrumbs(path).map(c => c.path), ["/", "/srv", "/srv/App", "/srv/App/a\\b", path]);
  assert.equal(remoteParent(path), "/srv/App/a\\b");
  assert.equal(remoteParent("/"), "/");
});

test("links only browse as folders after their target has been classified", () => {
  assert.equal(canBrowseEntry({ ...row("link"), isSymlink: true }), false);
  assert.equal(canBrowseEntry({ ...row("link", 1, true), isSymlink: true }), true);
});

test("remote video thumbnails require a regular file and stable metadata", () => {
  assert.equal(canPreviewRemoteVideo(row("video.MP4", 1024 ** 3)), true);
  for (const entry of [row("video.mp4", 0), row("video.mp4", null), row("video.mp4", 100, true),
    { ...row("video.mp4"), modified: null }, { ...row("video.mp4"), isSymlink: true }, row("image.png")]) {
    assert.equal(canPreviewRemoteVideo(entry), false);
  }
});

test("hidden filtering and sorting display case-distinct names without changing the remote listing", () => {
  const entries = [row("file2", 20), row(".profile", 1), row("FILE", 10), row("App", null, true), row("app", null, true)];
  const sorted = displayRemoteEntries(entries, { key: "size", dir: "desc" }, "", false);
  assert.deepEqual(new Set(sorted.slice(0, 2).map(e => e.name)), new Set(["app", "App"]));
  assert.deepEqual(sorted.slice(2).map(e => e.name), ["file2", "FILE"]);
  assert.deepEqual(displayRemoteEntries(entries, { key: "name", dir: "asc" }, "ApP", true).map(e => e.name).sort(), ["App", "app"]);
  assert.equal(entries[0].name, "file2");
});

test("supported images can use cached thumbnails even when large", () => {
  assert.equal(canPreviewRemote(row("image.JPEG", 1024 ** 2)), true);
  assert.equal(canPreviewRemote(row("image.png", 1024 ** 2 + 1)), true);
  for (const entry of [row("image.svg"), row("image.png", null), row("image.png", 25, true), { ...row("image.png"), isSymlink: true }]) {
    assert.equal(canPreviewRemote(entry), false);
  }
});
