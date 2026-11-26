import assert from "node:assert/strict";
import test from "node:test";
import { buildKeybindFromEvent, buildKeybindFromWheel, coerceKeybinds, formatKeybind, isBareCharacterKeybind } from "../src/modules/keybinds.ts";

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

test("thumbnail wheel defaults can be cleared and assigned to navigation", () => {
  const binding = buildKeybindFromWheel({ ctrlKey: true, deltaX: 0, deltaY: -100 });
  assert.equal(binding, "Control+WheelUp");
  assert.equal(formatKeybind(binding), "Ctrl+Scroll Up");
  assert.equal(coerceKeybinds({}).increaseThumbnailSize, binding);
  const reassigned = coerceKeybinds({ prevTab: binding, increaseThumbnailSize: "" });
  assert.equal(reassigned.prevTab, binding);
  assert.equal(reassigned.increaseThumbnailSize, "");
  assert.equal(coerceKeybinds({ prevTab: binding, increaseThumbnailSize: binding }).increaseThumbnailSize, "");
});

test("wheel shortcuts require modified vertical scroll and a supported action", () => {
  assert.equal(buildKeybindFromWheel({ deltaX: 0, deltaY: 100 }), null);
  assert.equal(buildKeybindFromWheel({ ctrlKey: true, deltaX: 100, deltaY: 25 }), null);
  assert.equal(buildKeybindFromWheel({ altKey: true, deltaX: 0, deltaY: 100 }), "Alt+WheelDown");
  assert.equal(coerceKeybinds({ nextTab: "WheelDown" }).nextTab, "Control+ArrowRight");
  assert.equal(coerceKeybinds({ deleteSelection: "Control+WheelDown" }).deleteSelection, "Delete");
});
