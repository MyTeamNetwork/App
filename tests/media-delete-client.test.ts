import test from "node:test";
import assert from "node:assert/strict";
import {
  BulkDeletePartialError,
  bulkDeleteSelectedMedia,
  getBulkDeletePartialFailureMessage,
  getBulkDeleteSuccessMessage,
} from "@/lib/media/delete-media-client";

function createIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `media-${index + 1}`);
}

test("bulkDeleteSelectedMedia returns early for an empty selection", async () => {
  let calls = 0;

  const result = await bulkDeleteSelectedMedia({
    orgId: "org-1",
    mediaIds: [],
    fetchImpl: async () => {
      calls += 1;
      return new Response();
    },
  });

  assert.deepEqual(result.deletedIds, []);
  assert.equal(calls, 0);
});

test("bulkDeleteSelectedMedia batches requests and aggregates deleted ids", async () => {
  const ids = createIds(150);
  const chunks: string[][] = [];

  const result = await bulkDeleteSelectedMedia({
    orgId: "org-1",
    mediaIds: ids,
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { mediaIds: string[] };
      chunks.push(body.mediaIds);
      return Response.json({ deletedIds: body.mediaIds });
    },
  });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 100);
  assert.equal(chunks[1].length, 50);
  assert.deepEqual(result.deletedIds, ids);
});

test("bulkDeleteSelectedMedia preserves earlier successes when a later chunk fails", async () => {
  const ids = createIds(102);
  let callCount = 0;

  await assert.rejects(
    () =>
      bulkDeleteSelectedMedia({
        orgId: "org-1",
        mediaIds: ids,
        fetchImpl: async (_input, init) => {
          callCount += 1;
          const body = JSON.parse(String(init?.body)) as { mediaIds: string[] };

          if (callCount === 1) {
            return Response.json({ deletedIds: body.mediaIds });
          }

          return Response.json({ error: "Chunk failed" }, { status: 500 });
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof BulkDeletePartialError);
      assert.equal(error.message, "Chunk failed");
      assert.deepEqual(error.deletedIds, ids.slice(0, 100));
      assert.deepEqual(error.failedIds, ids.slice(100));
      return true;
    },
  );
});

test("bulk delete messages describe full and partial results", () => {
  assert.equal(getBulkDeleteSuccessMessage(1), "Deleted 1 item");
  assert.equal(getBulkDeleteSuccessMessage(3), "Deleted 3 items");
  assert.equal(getBulkDeletePartialFailureMessage(2, 5), "Deleted 2 items; 5 failed");
});
