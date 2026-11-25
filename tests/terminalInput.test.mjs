import assert from "node:assert/strict";
import test from "node:test";
import { TerminalInput } from "../src/components/terminal/terminalInput.ts";

test("text and classic mouse reports retain their order and encoding", () => {
  const input = new TerminalInput();
  const prefix = "a".repeat(8191);
  input.push(prefix + "🚀", false);
  input.push("\x1b[M \xa0\xf0", true);
  input.push("ø", false);
  assert.equal(input.take(), prefix);
  assert.equal(input.take(), "🚀");
  assert.deepEqual(input.take(), [27, 91, 77, 32, 160, 240]);
  assert.equal(input.take(), "ø");
  assert.equal(input.take(), undefined);
});

test("both input types share the pending limit and a retry starts empty", () => {
  const input = new TerminalInput();
  assert.equal(input.push("a".repeat(128 * 1024), false), true);
  assert.equal(input.push("\xff", true), false);
  assert.equal(input.take().length, 8192);
  assert.equal(input.push("\xff", true), true);
  input.clear();
  assert.equal(input.take(), undefined);
  assert.equal(input.push("\xff", true), true);
  assert.deepEqual(input.take(), [255]);
});
