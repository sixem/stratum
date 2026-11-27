import assert from "node:assert/strict";
import test from "node:test";
import { selectRemoteListing } from "../src/components/remote/remoteListingState.ts";

test("a refresh keeps the existing listing until its new response arrives", () => {
  const previous = { location: "host-session-folder", request: "old", data: ["file"] };
  assert.deepEqual(selectRemoteListing(previous, previous.location, "new"), { data: ["file"], error: undefined });
  assert.deepEqual(selectRemoteListing({ location: previous.location, request: "new", data: ["new-file"] }, previous.location, "new"),
    { data: ["new-file"], error: undefined });
});

test("navigation, a new session, and refresh errors never show an unrelated listing", () => {
  const previous = { location: "host-session-folder", request: "old", data: ["file"] };
  assert.deepEqual(selectRemoteListing(previous, "other-folder", "new"), { data: undefined, error: undefined });
  assert.deepEqual(selectRemoteListing(previous, "new-session-folder", "old"), { data: undefined, error: undefined });
  assert.deepEqual(selectRemoteListing({ location: previous.location, request: "new", error: "Disconnected" }, previous.location, "new"),
    { data: undefined, error: "Disconnected" });
});
