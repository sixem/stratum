// Exercise capture, JSON validation, durable import and store publication together.
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createServer } from "vite";

test("full and workspace-only backups restore remote hosts into a clean profile", async () => {
  const previousStorage = globalThis.localStorage;
  const previousDocument = globalThis.document;
  const values = new Map();
  let failingKey = null;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      if (key === failingKey) throw new Error("Storage unavailable");
      values.set(key, String(value));
    },
    removeItem: key => values.delete(key),
  };
  globalThis.document = { querySelector: () => null };
  const server = await createServer({
    configFile: false, logLevel: "silent", appType: "custom",
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: { ignored: ["**"] } },
  });
  try {
    const { captureStratumBackup, applyStratumBackup } = await server.ssrLoadModule("/src/modules/backup/profile.ts");
    const { readStratumBackup } = await server.ssrLoadModule("/src/modules/backup/schema.ts");
    const { useSessionStore, useBottomSessionStore, createSessionTab } = await server.ssrLoadModule("/src/modules/sessionStore.ts");
    const { useRemoteHosts } = await server.ssrLoadModule("/src/modules/remoteHosts.ts");
    const { useWorkspaceStore, switchWorkspace } = await server.ssrLoadModule("/src/modules/workspaceStore.ts");
    const { captureWorkspaceLayout } = await server.ssrLoadModule("/src/lib/captureWorkspaceLayout.ts");
    const host = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", destination: "alice@example", name: "Server", startPath: "/home/alice" };
    const unused = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", destination: "other@example", name: "Other", startPath: "" };
    const tab = { ...createSessionTab(""), kind: "remote", remote: { hostId: host.id, path: "/projects" } };
    useRemoteHosts.setState({ profiles: [host, unused], connections: {} });
    useSessionStore.setState({ tabs: [tab], activeTabId: tab.id, recentJumps: [] });
    const layout = captureWorkspaceLayout();
    useWorkspaceStore.setState({ workspaces: [{ id: "workspace", name: "Project", layout }], activeId: "workspace", previous: null, drafts: [] });
    const selected = new Set(["workspace"]);
    const full = captureStratumBackup("full", selected);
    const workspaces = captureStratumBackup("workspaces", selected);
    const excluded = captureStratumBackup("workspaces", selected, false);
    assert.deepEqual(full.remoteHosts, [host, unused]);
    assert.deepEqual(workspaces.remoteHosts, [host]);
    assert.equal(excluded.remoteHosts, undefined);

    const clean = () => {
      useSessionStore.getState().resetSession();
      useBottomSessionStore.getState().resetSession();
      useWorkspaceStore.setState({ workspaces: [], activeId: null, previous: null, drafts: [] });
      useRemoteHosts.setState({ profiles: [], connections: {} });
      values.clear();
    };
    clean();
    const parsedFull = readStratumBackup(JSON.stringify(full));
    failingKey = "stratum.remoteHosts";
    assert.throws(() => applyStratumBackup(parsedFull, { conflicts: "copies", restorePreferences: true, openSession: true }), /Couldn't save/);
    assert.equal(useWorkspaceStore.getState().workspaces.length, 0);
    assert.deepEqual(useRemoteHosts.getState().profiles, []);
    assert.equal(values.size, 0);
    failingKey = null;
    applyStratumBackup(parsedFull, { conflicts: "copies", restorePreferences: true, openSession: true });
    assert.deepEqual(useRemoteHosts.getState().profiles, [host, unused]);
    assert.deepEqual(useSessionStore.getState().tabs[0].remote, { hostId: host.id, path: "/projects" });
    assert.deepEqual(JSON.parse(values.get("stratum.remoteHosts")), [host, unused]);

    clean();
    const parsedWorkspaces = readStratumBackup(JSON.stringify(workspaces));
    applyStratumBackup(parsedWorkspaces, { conflicts: "copies", restorePreferences: false, openSession: false });
    assert.deepEqual(useRemoteHosts.getState().profiles, [host]);
    const imported = useWorkspaceStore.getState().workspaces[0];
    switchWorkspace({ id: imported.id, layout: imported.layout }, captureWorkspaceLayout());
    assert.deepEqual(useSessionStore.getState().tabs[0].remote, { hostId: host.id, path: "/projects" });

    clean();
    const collision = { ...unused, id: host.id };
    useRemoteHosts.setState({ profiles: [collision], connections: {} });
    applyStratumBackup(parsedFull, { conflicts: "copies", restorePreferences: false, openSession: true });
    const importedHost = useRemoteHosts.getState().profiles.find(profile => profile.destination === host.destination);
    assert.notEqual(importedHost.id, collision.id);
    assert.equal(useSessionStore.getState().tabs[0].remote.hostId, importedHost.id);
    assert.deepEqual(useRemoteHosts.getState().profiles[0], collision);

    clean();
    useRemoteHosts.setState({ profiles: [collision], connections: {} });
    const oldBackup = JSON.parse(JSON.stringify(workspaces));
    delete oldBackup.remoteHosts;
    const parsedOld = readStratumBackup(JSON.stringify(oldBackup));
    applyStratumBackup(parsedOld, { conflicts: "copies", restorePreferences: false, openSession: false });
    assert.notEqual(useWorkspaceStore.getState().workspaces[0].layout.main.tabs[0].remote.hostId, collision.id);
    clean();
    useRemoteHosts.setState({ profiles: [collision], connections: {} });
    applyStratumBackup(parsedOld, { conflicts: "copies", restorePreferences: false, openSession: false, remoteHostMappings: { [host.id]: collision.id } });
    assert.equal(useWorkspaceStore.getState().workspaces[0].layout.main.tabs[0].remote.hostId, collision.id);
    assert.throws(() => readStratumBackup(JSON.stringify({ ...workspaces, remoteHosts: [host, host] })), /valid Stratum backup/);
    assert.throws(() => readStratumBackup(JSON.stringify({ ...workspaces, remoteHosts: [{ ...host, destination: "-invalid" }] })), /valid Stratum backup/);
  } finally {
    await server.close();
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
