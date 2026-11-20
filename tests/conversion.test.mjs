import assert from "node:assert/strict";
import test from "node:test";
import { buildConversionModalDraft } from "../src/hooks/ui/app/conversion/conversionDrafts.ts";
import { conversionFileName } from "../src/hooks/ui/app/conversion/conversionNames.ts";
import { failedConversionDraft } from "../src/hooks/ui/app/conversion/conversionRetry.ts";
import { prepareConversionJob } from "../src/hooks/ui/app/conversion/prepareConversionJob.ts";

function videoRequest(...names) {
  const items = names.map(name => ({
    path: "D:\\clips\\" + name, name, kind: "video", sourceExt: name.split(".").pop().toLowerCase(),
  }));
  return { items, paths: items.map(item => item.path), sourceKinds: ["video"], quickTargetFormat: null, quickTargetKind: null };
}

function plan(draft, existing = []) {
  const statEntries = async paths => paths.map(path => ({
    path, size: existing.includes(path) ? 0 : null, modified: null,
  }));
  return prepareConversionJob({ draft, statEntries, ffmpegPath: "" });
}

test("default MP4 re-encoding creates a sibling and preserves the original", async () => {
  const request = videoRequest("Example.MP4");
  const draft = buildConversionModalDraft(request);
  const [item] = (await plan(draft, ["D:\\clips\\Example_converted.mp4"])).items;
  assert.equal(item.destinationPath, "D:\\clips\\Example_converted (1).mp4");
  assert.equal(item.options.overwrite, false);
  assert.equal(item.deleteSourceAfterSuccess, false);
  draft.outputMode = "replace";
  const [replace] = (await plan(draft)).items;
  assert.equal(replace.destinationPath, request.paths[0]);
  assert.equal(replace.options.overwrite, true);
  assert.equal(replace.deleteSourceAfterSuccess, false);
});

test("quick WebM and per-file overrides produce container-compatible encoders and quality", async () => {
  const request = { ...videoRequest("one.MP4", "two.mkv"), quickTargetKind: "video", quickTargetFormat: "webm" };
  const draft = buildConversionModalDraft(request);
  assert.equal(draft.videoOptions.presetId, "webm_balanced");
  draft.items[1].override = { targetFormat: "mov" };
  const [webm, mov] = (await plan(draft)).items;
  assert.equal(webm.options.encoder, "libvpx-vp9");
  assert.equal(webm.options.quality, 32);
  assert.equal(mov.options.encoder, "libx264");
  assert.equal(mov.options.quality, 20);
  assert.equal(mov.destinationPath, "D:\\clips\\two_converted.mov");
  assert.equal(conversionFileName("one.MP4", "webm", "create-new", draft.suffix), "one_converted.webm");
});

test("Replace refuses to overwrite another source or an existing sibling", async () => {
  for (const names of [["one.mov", "one.mp4"], ["one.mp4", "one.mov"], ["one.mov", "one.mkv"]]) {
    const request = videoRequest(...names);
    const draft = { ...buildConversionModalDraft(request), outputMode: "replace" };
    await assert.rejects(plan(draft), /Another selected file/);
  }
  const request = videoRequest("one.mov");
  const draft = { ...buildConversionModalDraft(request), outputMode: "replace" };
  await assert.rejects(plan(draft, ["D:\\clips\\one.mp4"]), /already exists/);
  const [item] = (await plan(draft)).items;
  assert.equal(item.options.overwrite, false);
  assert.equal(item.deleteSourceAfterSuccess, true);
});

test("large video batches check names in bounded IPC calls and cancellation stops planning", async () => {
  const request = videoRequest(...Array.from({length: 515}, (_, index) => `clip${index}.mkv`));
  const draft = buildConversionModalDraft(request);
  const sizes = [];
  const statEntries = async paths => {
    sizes.push(paths.length);
    return paths.map(path => ({ path, size: null, modified: null }));
  };
  const options = { draft, statEntries, ffmpegPath: "" };
  const result = await prepareConversionJob(options);
  assert.equal(result.items.length, 515);
  assert.deepEqual(sizes, [256, 256, 3]);
  const controller = new AbortController();
  sizes.length = 0;
  await assert.rejects(prepareConversionJob({
    ...options, signal: controller.signal,
    statEntries: paths => { controller.abort(); return statEntries(paths); },
  }), { name: "AbortError" });
  assert.deepEqual(sizes, [256]);
});

test("file suffixes cannot introduce a directory or alternate data stream", async () => {
  const draft = buildConversionModalDraft(videoRequest("one.mp4"));
  for (const suffix of ["\\..\\elsewhere", ":stream", "a/b"]) {
    await assert.rejects(plan({ ...draft, suffix }), /suffix/);
  }
  const [sameExtension] = (await plan({ ...draft, suffix: "" })).items;
  assert.equal(sameExtension.destinationPath, "D:\\clips\\one (1).mp4");
});

test("retry keeps the failed items' edited options and drops completed items", () => {
  const request = videoRequest("one.mp4", "two.mov");
  const draft = buildConversionModalDraft(request);
  draft.items[1].override = { targetFormat: "webm" };
  const retry = failedConversionDraft(request, draft, [request.paths[1]]);
  assert.deepEqual(retry.request.paths, [request.paths[1]]);
  assert.equal(retry.draft.items.length, 1);
  assert.equal(retry.draft.items[0].override.targetFormat, "webm");
  assert.equal(failedConversionDraft(request, draft, []), null);
});
