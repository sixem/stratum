import assert from "node:assert/strict";
import test from "node:test";
import { cancelPreviewSeek, previewSeekTime, seekPreviewMedia } from "../src/components/preview/previewSeek.ts";

test("a busy decoder gets the latest requested time on completion or timeout", async () => {
  const media = Object.assign(new EventTarget(), { currentTime: 0, seeking: false });
  seekPreviewMedia(media, 10);
  assert.equal(media.currentTime, 10);
  media.seeking = true;
  seekPreviewMedia(media, 20);
  seekPreviewMedia(media, 30);
  assert.equal(media.currentTime, 10);
  assert.equal(previewSeekTime(media), 30);
  media.dispatchEvent(new Event("seeked"));
  assert.equal(media.currentTime, 30);

  seekPreviewMedia(media, 40);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(media.currentTime, 40);
  seekPreviewMedia(media, 50);
  cancelPreviewSeek(media);
  media.dispatchEvent(new Event("seeked"));
  assert.equal(previewSeekTime(media), 40);
});
