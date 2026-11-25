import assert from "node:assert/strict";
import test from "node:test";
import { buildKeybindFromEvent, coerceKeybinds, formatKeybind, isBareCharacterKeybind } from "../src/modules/keybinds.ts";

test("Ctrl+Space survives keyboard capture and settings reload", () => {
  const binding = buildKeybindFromEvent({ key: " ", ctrlKey: true });
  assert.equal(binding, "Control+Space");
  assert.equal(isBareCharacterKeybind(binding), false);
  assert.equal(coerceKeybinds({ nextTab: binding }).nextTab, binding);
  assert.equal(formatKeybind(binding), "Ctrl+Space");
});

test("assigning plain or shifted Space follows the printable-character rule", () => {
  for (const shiftKey of [false, true]) {
    assert.equal(isBareCharacterKeybind(buildKeybindFromEvent({ key: " ", shiftKey })), true);
  }
});
