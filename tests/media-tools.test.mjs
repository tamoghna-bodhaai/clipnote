import assert from "node:assert/strict";
import { test } from "node:test";
import { isYoutubeAccessError } from "../lib/media-tools.ts";

test("YouTube embed error 152 allows the next player client to be tried", () => {
  const error = new Error("yt-dlp exited with status 1");
  error.stderr = "ERROR: [youtube] X_7_5OLnMR4: This video is unavailable. Error code: 152 - 18 Watch video on YouTube";
  assert.equal(isYoutubeAccessError(error), true);
});
