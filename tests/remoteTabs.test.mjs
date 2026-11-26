import test from "node:test";
import assert from "node:assert/strict";
import { readTabContent, selectRestoredFolder } from "../src/lib/tabRestore.ts";
import { navigateRemoteTab } from "../src/lib/remoteNavigation.ts";
import { mapTabLocations } from "../src/lib/tabLocations.ts";

const first = { id: "one", kind: "remote", path: "", remote: { hostId: "host-one", path: "/srv/App" }, scrollTop: 200 };

test("remote folder navigation preserves case, literal spaces, and host identity", () => {
  const next = navigateRemoteTab(first, { path: "/srv/app " });
  assert.equal(next.path, "");
  assert.deepEqual(next.remote, { hostId: "host-one", path: "/srv/app " });
  assert.equal(next.scrollTop, 0);
  const previous = navigateRemoteTab(next, "back");
  assert.deepEqual(previous.remote, first.remote);
  assert.deepEqual(navigateRemoteTab(previous, "forward").remote, next.remote);
  assert.equal(mapTabLocations(next, () => assert.fail("Windows path remap")), next);
  assert.equal(navigateRemoteTab(next, { path: "C:\\Users" }), next);
});

test("remote-only saved sessions restore the active remote folder", () => {
  assert.deepEqual(readTabContent(first, first.id), { kind: "remote", remote: first.remote });
  assert.equal(readTabContent({ kind: "remote", remote: { hostId: "one", path: "relative" } }, "one"), null);
  const restored = selectRestoredFolder({ tabs: [first], activeTabId: first.id });
  assert.equal(restored.tabs.length, 1);
  assert.equal(restored.activeTabId, first.id);
});

test("restoration keeps the selected remote tab in a mixed workspace", () => {
  const local = { id: "local", kind: "folder", path: "C:\\Work" };
  const terminal = { id: "shell", kind: "terminal", path: "" };
  assert.equal(selectRestoredFolder({ tabs: [local, first], activeTabId: first.id }).activeTabId, first.id);
  assert.equal(selectRestoredFolder({ tabs: [terminal, first], activeTabId: terminal.id }).activeTabId, null);
  assert.equal(selectRestoredFolder({ tabs: [terminal, local, first], activeTabId: terminal.id }).activeTabId, local.id);
});

test("ascending keeps the remote breadcrumb trail and history jumps preserve literal names", () => {
  const deep = navigateRemoteTab(first, { path: "/srv/App/deep " });
  const up = navigateRemoteTab(deep, { path: "/srv" });
  assert.equal(up.crumbTrailPath, "/srv/App/deep ");
  const jumped = navigateRemoteTab(up, "back", 1, "/srv/App");
  assert.equal(jumped.remote.path, "/srv/App");
  assert.equal(navigateRemoteTab(jumped, "forward").remote.path, "/srv/App/deep ");
  const sibling = navigateRemoteTab(up, { path: "/srv/app" });
  assert.equal(sibling.crumbTrailPath, "/srv/app");
});
