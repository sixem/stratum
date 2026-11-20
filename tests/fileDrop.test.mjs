import assert from "node:assert/strict";
import test from "node:test";
import { usePromptStore } from "../src/modules/promptStore.ts";
import { FileDropQueue } from "../src/hooks/domain/filesystem/nativeFileDrag.ts";
import { buildDropCandidate, normalizeDropPath, sanitizeDropPath } from "../src/lib/dropPaths.ts";

test("replacing a drop conflict cancels its decision and leaves the new prompt open", async (t) => {
  const { showPrompt, hidePrompt } = usePromptStore.getState();
  t.after(() => hidePrompt());
  const decision = Promise.withResolvers();
  const conflict = { content: "Replace the file?", onCancel: () => decision.resolve("cancel") };
  const next = { content: "File activity finished" };

  showPrompt(conflict);
  showPrompt(next);

  assert.equal(await decision.promise, "cancel");
  assert.equal(hidePrompt(conflict), false);
  assert.equal(usePromptStore.getState().prompt, next);
  assert.equal(hidePrompt(next), true);
});

test("a second drop waits for the first decision and survives its failure", async () => {
  const queue = new FileDropQueue();
  const waiting = Promise.withResolvers();
  const events = [];
  const first = queue.add(async () => {
    events.push("first");
    await waiting.promise;
    throw new Error("source went offline");
  });
  const second = queue.add(async () => { events.push("second"); });
  assert.equal(queue.busy, true);
  await Promise.resolve();
  assert.deepEqual(events, ["first"]);
  waiting.resolve();
  await assert.rejects(first, /offline/);
  await second;
  assert.equal(queue.busy, false);
  assert.deepEqual(events, ["first", "second"]);
});

test("native drops retain usable volume GUID and extended paths", () => {
  const volume = String.raw`\\?\Volume{8fd2b351-7262-4799-907c-17334e096365}`;
  const file = volume + "\\file.txt";
  assert.equal(buildDropCandidate(file, normalizeDropPath("E:\\target")).path, file);
  assert.equal(buildDropCandidate(file, normalizeDropPath(volume + "\\")).isSameDirectory, true);
  assert.equal(normalizeDropPath(String.raw`\\?\UNC\server\share\Dir`), normalizeDropPath(String.raw`\\server\share\Dir`));
  assert.equal(normalizeDropPath(String.raw`\\?\E:\Dir`), normalizeDropPath("E:\\Dir"));
  assert.equal(sanitizeDropPath("file://server/share/My%20File.txt"), String.raw`\\server\share\My File.txt`);
  assert.equal(sanitizeDropPath("file:///E:/My%20File.txt"), "E:\\My File.txt");
});
