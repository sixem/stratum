import assert from "node:assert/strict";
import test from "node:test";
import { fileManagerStatus } from "../src/hooks/domain/filesystem/fileManagerStatus.ts";

test("footer identifies active indexing and prioritizes foreground work", () => {
  const base = { loadingPath: null, fileActivity: null, placesLoaded: true };
  assert.deepEqual(fileManagerStatus({ ...base, indexState: "starting" }),
    { level: "loading", message: "Checking saved indexes" });
  assert.deepEqual(fileManagerStatus({ ...base, indexState: "scanning", indexActivity: "Applying changes on C:" }),
    { level: "loading", message: "Applying changes on C:" });
  assert.deepEqual(fileManagerStatus({ ...base, indexState: "scanning", loadingPath: "D:\\Photos" }),
    { level: "loading", message: "Loading D:\\Photos" });
  assert.deepEqual(fileManagerStatus({ ...base, indexState: "error" }),
    { level: "error", message: "Indexed search unavailable" });
  assert.deepEqual(fileManagerStatus({ ...base, indexState: "idle" }), { level: "idle", message: "Ready" });
});
