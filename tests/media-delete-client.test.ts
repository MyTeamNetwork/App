import test from "node:test";
import assert from "node:assert/strict";
import {
  bulkDeleteSelectedMedia,
  chunkBulkDeleteMediaIds,
  MEDIA_BULK_DELETE_BATCH_SIZE,
} from "@/lib/media/delete-media-client";
import {
  canDeleteAllMediaItems,
  canDeleteMediaItem,
  filterBulkDeleteSelection,
  getBulkDeleteEligibleIds,
} from "@/lib/media/delete-selection";

test("non-admin gallery bulk delete only allows the user's own uploads", () => {
  const items = [
    { id: "media-1", uploaded_by: "user-1" },
    { id: "media-2", uploaded_by: "user-2" },
  ];

  assert.equal(canDeleteMediaItem(items[0], { isAdmin: false, currentUserId: "user-1" }), true);
  assert.equal(canDeleteMediaItem(items[1], { isAdmin: false, currentUserId: "user-1" }), false);
  assert.deepEqual(
    getBulkDeleteEligibleIds(items, { isAdmin: false, currentUserId: "user-1" }),
    ["media-1"],
  );
  assert.deepEqual(
    filterBulkDeleteSelection(items, ["media-1", "media-2"], { isAdmin: false, currentUserId: "user-1" }),
    ["media-1"],
  );
  assert.equal(canDeleteAllMediaItems(items, { isAdmin: false, currentUserId: "user-1" }), false);
});

test("admins can bulk delete every visible upload", () => {
  const items = [
    { id: "media-1", uploaded_by: "user-1" },
    { id: "media-2", uploaded_by: "user-2" },
  ];

  assert.deepEqual(
    getBulkDeleteEligibleIds(items, { isAdmin: true }),
    ["media-1", "media-2"],
  );
  assert.equal(canDeleteAllMediaItems(items, { isAdmin: true }), true);
});

test("bulk delete client chunks large selections into 100-item requests", () => {
  const mediaIds = Array.from({ length: MEDIA_BULK_DELETE_BATCH_SIZE * 2 + 5 }, (_, index) => `media-${index + 1}`);

  assert.deepEqual(
    chunkBulkDeleteMediaIds(mediaIds).map((chunk) => chunk.length),
    [100, 100, 5],
  );
});

test("bulk delete client aggregates batched responses", async () => {
  const calls: string[][] = [];
  const fetchImpl: typeof fetch = (async (_input, init) => {
    const parsed = JSON.parse(String(init?.body ?? "{}")) as { mediaIds: string[] };
    calls.push(parsed.mediaIds);

    return {
      ok: true,
      json: async () => ({ deletedIds: parsed.mediaIds }),
    } as Response;
  }) as typeof fetch;

  const result = await bulkDeleteSelectedMedia({
    orgId: "org-1",
    mediaIds: Array.from({ length: 205 }, (_, index) => `media-${index + 1}`),
    fetchImpl,
  });

  assert.deepEqual(calls.map((chunk) => chunk.length), [100, 100, 5]);
  assert.equal(result.deletedCount, 205);
  assert.equal(result.deletedIds[0], "media-1");
  assert.equal(result.deletedIds.at(-1), "media-205");
});
