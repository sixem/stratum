import assert from "node:assert/strict";
import test from "node:test";
import { buildBatchRenamePreview, prepareBatchRenameSelection } from "../src/lib/batchRename.ts";

const entry = (parent, name, isDir = false) => ({ path: parent + name, name, isDir });

test("batch rename reuses a selection across rules and checks collisions within each parent", () => {
  const items = [
    entry("C:\\Photos\\", "same_.txt"),
    entry("c:/photos/", "same__.txt"),
    entry("C:\\Photos\\", "same.txt"),
    entry("C:\\Other\\", "same_.txt"),
  ];
  const selection = prepareBatchRenameSelection(items);
  const replace = { mode: "replace", find: "_", replacement: "", matchCase: true };
  const rows = buildBatchRenamePreview(selection, replace, true);
  assert.deepEqual(rows.map(({ nextName }) => nextName), Array(4).fill("same.txt"));
  const duplicate = "Multiple items would get this name.";
  assert.deepEqual(rows.map(({ error }) => error), [duplicate, duplicate, undefined, undefined]);

  const edited = buildBatchRenamePreview(selection, { ...replace, occurrence: "first" }, true);
  assert.deepEqual(edited.map(({ error }) => error), [
    "Another selected item already has this name.",
    "Another selected item already has this name.",
    undefined,
    undefined,
  ]);
  const affix = { mode: "affix", prefix: "", suffix: "-old" };
  assert.deepEqual(buildBatchRenamePreview(selection, affix, true).map(({ nextName }) => nextName), [
    "same_-old.txt", "same__-old.txt", "same-old.txt", "same_-old.txt",
  ]);
  assert.deepEqual(rows.map(({ error }) => error), [duplicate, duplicate, undefined, undefined]);
});

test("cached extensions support changing preservation for files, dotfiles and dotted folders", () => {
  const items = [
    entry("C:\\Photos\\", "Photo.TXT"),
    entry("C:\\Photos\\", "Folder.cfg", true),
    entry("C:\\Photos\\", ".gitignore"),
  ];
  const selection = prepareBatchRenameSelection(items);
  const rule = {
    mode: "number", baseName: "New.bin",
    numbering: { start: 1, step: 1, digits: 1, position: "after", style: "dash", numberFirst: true },
  };
  assert.deepEqual(buildBatchRenamePreview(selection, rule, true).map(({ nextName }) => nextName), [
    "New.bin-1.TXT", "New.bin-2", "New.bin-3",
  ]);
  assert.deepEqual(buildBatchRenamePreview(selection, rule, false).map(({ nextName }) => nextName), [
    "New-1.bin", "New.bin-2", "New-3.bin",
  ]);
});
