import assert from "node:assert/strict";
import test from "node:test";
import { selectedRemoteEntries } from "../src/components/remote/remoteSelection.ts";

test("remote pane actions use only listed entries from a range selection", () => {
  const file = { path: "/home/docs/note.txt" };
  const folder = { path: "/home/docs/archive" };
  const listing = new Map([file, folder].map(entry => [entry.path, entry]));
  const range = new Set(["/home", folder.path, "/home/docs/removed", file.path]);
  assert.deepEqual(selectedRemoteEntries(range, listing), [folder, file]);
  assert.deepEqual(selectedRemoteEntries(["/home"], listing), []);
});
