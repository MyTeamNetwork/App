import test from "node:test";
import assert from "node:assert/strict";
import {
  getGalleryRetryProgress,
  getGalleryUploadMode,
} from "@/lib/media/gallery-upload-flow";

test("retry resumes album association without re-uploading once media finalization already succeeded", () => {
  assert.equal(
    getGalleryUploadMode({
      mediaId: "media-1",
      targetAlbumId: "album-1",
      uploadFinalized: true,
    }),
    "associate-only",
  );
});

test("upload flow performs a full upload when media has not finished finalizing", () => {
  assert.equal(
    getGalleryUploadMode({
      mediaId: "media-1",
      targetAlbumId: "album-1",
      uploadFinalized: false,
    }),
    "upload",
  );
});

test("retry progress stays at 100 percent when only album association remains", () => {
  assert.equal(getGalleryRetryProgress(true), 100);
  assert.equal(getGalleryRetryProgress(false), 0);
});
