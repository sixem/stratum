import assert from "node:assert/strict";
import test from "node:test";
import { indexedResultLookup } from "../src/components/overlay/indexedSearchModal/indexedResultLookup.ts";
import { createIndexedGalleryLookup } from "../src/components/overlay/indexedSearchModal/indexedSearchGallery.ts";

const match = (name, kind = "file") => ({ path: "C:/" + name, name, kind });

test("paging and unsupported preview targets leave unrelated rows unread", () => {
  let nameReads = 0;
  const photo = { path: "C:/a.JPG", kind: "file", get name() { nameReads++; return "a.JPG"; } };
  const rows = [photo, match("notes.txt"), match("dir.png", "directory"), match("b.mp4")];
  const indexes = new Map(rows.map((row, index) => [row.path, index]));
  const getGallery = createIndexedGalleryLookup(rows, indexedResultLookup(indexes, rows.length), () => {});

  for (const path of ["C:/missing", rows[1].path, rows[2].path]) {
    assert.equal(getGallery(path), undefined);
  }
  assert.equal(nameReads, 0);

  const gallery = getGallery(rows[3].path);
  assert.deepEqual(gallery.items.map(entry => entry.path), [photo.path, rows[3].path]);
  assert.equal(gallery.entryByPath.get(photo.path), gallery.items[0]);
  const readsAfterOpen = nameReads;
  assert.equal(getGallery(photo.path), gallery);
  assert.equal(getGallery(rows[1].path), undefined);
  assert.equal(nameReads, readsAfterOpen);
});

test("a gallery can open after a later page arrives and still select within its own results", () => {
  const first = [match("first.jpg")];
  const next = [...first, match("second.png")];
  const indexes = new Map([[first[0].path, 0]]);
  const selected = [];
  const select = row => selected.push(row);
  const firstPage = createIndexedGalleryLookup(first, indexedResultLookup(indexes, first.length), select);
  indexes.set(next[1].path, 1);
  const nextPage = createIndexedGalleryLookup(next, indexedResultLookup(indexes, next.length), select);

  assert.equal(firstPage(next[1].path), undefined);
  const original = firstPage(first[0].path);
  const expanded = nextPage(next[1].path);
  assert.deepEqual(original.items.map(entry => entry.path), [first[0].path]);
  assert.deepEqual(expanded.items.map(entry => entry.path), next.map(row => row.path));
  original.onSelectPath(next[1].path);
  expanded.onSelectPath(next[1].path);
  original.onSelectPath(first[0].path);
  assert.deepEqual(selected, [next[1], first[0]]);
});
