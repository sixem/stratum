import assert from "node:assert/strict";
import test from "node:test";
import { isRemoteClipboardCurrent } from "../src/lib/remoteClipboardState.ts";

test("a remote selection is usable only for the clipboard write that created it", () => {
  assert.equal(isRemoteClipboardCurrent(42, 42), true);
  assert.equal(isRemoteClipboardCurrent(42, 43), false);
  assert.equal(isRemoteClipboardCurrent(0, 0), false);
  assert.equal(isRemoteClipboardCurrent(42, 0), false);
});
