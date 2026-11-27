import assert from "node:assert/strict";
import test from "node:test";
import { usePromptStore } from "../src/modules/promptStore.ts";

test("reconnect notices and competing prompts wait for a remote open in arrival order", () => {
  const { showPrompt, hidePrompt } = usePromptStore.getState();
  const open = { content: "Opening file", queued: true, onCancel: () => assert.fail("Open cancelled") };
  const hostA = { content: "Host A recovery", queued: true };
  const hostB = { content: "Host B recovery", queued: true };
  const ordinary = { content: "Other activity" };
  for (const prompt of [open, hostA, hostB, ordinary]) showPrompt(prompt);
  for (const prompt of [open, hostA, hostB, ordinary]) {
    assert.equal(usePromptStore.getState().prompt, prompt);
    assert.equal(hidePrompt(prompt), true);
  }
  assert.equal(usePromptStore.getState().prompt, null);
});

test("a remote open that finishes while queued withdraws only its own prompt", () => {
  const { showPrompt, hidePrompt } = usePromptStore.getState();
  const active = { content: "Replace file?", onCancel: () => assert.fail("Conflict cancelled") };
  const open = { content: "Opening file", queued: true };
  const notice = { content: "Interrupted operation", queued: true };
  showPrompt(active);
  showPrompt(open);
  showPrompt(notice);
  assert.equal(hidePrompt(open), true);
  assert.equal(usePromptStore.getState().prompt, active);
  hidePrompt(active);
  assert.equal(usePromptStore.getState().prompt, notice);
  assert.equal(hidePrompt(open), false);
  hidePrompt(notice);
  assert.equal(usePromptStore.getState().prompt, null);
});
