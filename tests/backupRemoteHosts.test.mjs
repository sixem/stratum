import test from "node:test";
import assert from "node:assert/strict";
import { listBackupRemoteHostIds, planBackupRemoteHosts, selectBackupRemoteHosts, UNLINKED_REMOTE_HOST } from "../src/modules/backup/remoteHosts.ts";

const hostA = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", destination: "alice@example", name: "Example", startPath: "/home/alice" };
const hostB = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", destination: "bob@example", name: "Other", startPath: "" };
const newId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const session = id => ({ tabs: [{ id: "tab", kind: "remote", path: "", remote: { hostId: id, path: "/data" } }], activeTabId: "tab", recentJumps: [] });
const layout = (main, bottom = main) => ({ main: session(main), bottom: session(bottom), pane: { link: null }, places: { places: [] } });
const workspace = (id, saved, draft) => ({ id, name: id, layout: saved, draft, recentMoves: [] });

test("full and workspace exports include the appropriate remote host profiles", () => {
  const workspaces = [workspace("project", layout(hostA.id))];
  const backup = { scope: "workspaces", workspaces };
  assert.deepEqual(selectBackupRemoteHosts(backup, [{ ...hostA, privateKey: "must not be exported" }, hostB]), [hostA]);
  assert.deepEqual(selectBackupRemoteHosts({ ...backup, scope: "full", profile: {
    current: { layout: layout(hostA.id) }, previous: { layout: layout(hostB.id) },
  } }, [hostA, hostB]), [hostA, hostB]);
});

test("conflicting IDs do not redirect imported tabs to an unrelated existing host", () => {
  const unrelated = { ...hostB, id: hostA.id };
  const backup = { scope: "full", remoteHosts: [hostA], workspaces: [workspace("project", layout(hostA.id), layout(hostA.id))],
    profile: { current: { id: "project", layout: layout(hostA.id) }, previous: { id: null, layout: layout(hostA.id) } } };
  const plan = planBackupRemoteHosts(backup, [unrelated], {}, () => newId);
  assert.deepEqual(plan.profiles, [unrelated, { ...hostA, id: newId }]);
  assert.deepEqual(listBackupRemoteHostIds(plan.backup), [newId]);
  assert.equal(plan.backup.workspaces[0].draft.bottom.tabs[0].remote.path, "/data");
  assert.equal(backup.profile.current.layout.main.tabs[0].remote.hostId, hostA.id);
});

test("existing destinations and explicit mappings are reused without changing local hosts", () => {
  const existing = { ...hostA, id: hostB.id, name: "Local name", startPath: "/local" };
  const backup = { scope: "workspaces", remoteHosts: [hostA], workspaces: [workspace("project", layout(hostA.id))] };
  const automatic = planBackupRemoteHosts(backup, [existing]);
  assert.deepEqual(automatic.profiles, [existing]);
  assert.deepEqual(listBackupRemoteHostIds(automatic.backup), [existing.id]);
  const mapped = planBackupRemoteHosts(backup, [hostB], { [hostA.id]: hostB.id });
  assert.deepEqual(mapped.profiles, [hostB]);
  assert.deepEqual(listBackupRemoteHostIds(mapped.backup), [hostB.id]);
  assert.throws(() => planBackupRemoteHosts(backup, [], { [hostA.id]: hostB.id }), /no longer available/);
});

test("missing or explicitly excluded host details remain unlinked unless mapped", () => {
  const backup = { scope: "workspaces", workspaces: [workspace("project", layout(hostA.id))] };
  const unlinked = planBackupRemoteHosts(backup, [hostA], {}, () => newId);
  assert.deepEqual(listBackupRemoteHostIds(unlinked.backup), [newId]);
  assert.deepEqual(unlinked.missing, [hostA.id]);
  const mapped = planBackupRemoteHosts(backup, [hostA], { [hostA.id]: hostA.id });
  assert.deepEqual(listBackupRemoteHostIds(mapped.backup), [hostA.id]);
  const excluded = planBackupRemoteHosts({ ...backup, remoteHosts: [hostA] }, [hostA], { [hostA.id]: UNLINKED_REMOTE_HOST }, () => newId);
  assert.deepEqual(listBackupRemoteHostIds(excluded.backup), [newId]);
});
