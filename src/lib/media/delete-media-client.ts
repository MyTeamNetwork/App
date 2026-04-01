export const MEDIA_BULK_DELETE_BATCH_SIZE = 100;

interface BulkDeleteRequest {
  orgId: string;
  mediaIds: string[];
  batchSize?: number;
  fetchImpl?: typeof fetch;
}

interface BulkDeleteResult {
  deletedIds: string[];
  deletedCount: number;
}

export function chunkBulkDeleteMediaIds(
  mediaIds: string[],
  batchSize = MEDIA_BULK_DELETE_BATCH_SIZE,
): string[][] {
  const uniqueIds = Array.from(new Set(mediaIds));
  if (uniqueIds.length === 0) return [];

  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += batchSize) {
    chunks.push(uniqueIds.slice(index, index + batchSize));
  }
  return chunks;
}

export async function bulkDeleteSelectedMedia({
  orgId,
  mediaIds,
  batchSize = MEDIA_BULK_DELETE_BATCH_SIZE,
  fetchImpl = fetch,
}: BulkDeleteRequest): Promise<BulkDeleteResult> {
  const chunks = chunkBulkDeleteMediaIds(mediaIds, batchSize);
  if (chunks.length === 0) {
    return { deletedIds: [], deletedCount: 0 };
  }

  const deletedIds: string[] = [];

  for (const chunk of chunks) {
    const res = await fetchImpl("/api/media/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, mediaIds: chunk }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || "Failed to delete");
    }

    const data = await res.json().catch(() => null);
    const batchDeletedIds = Array.isArray(data?.deletedIds) ? data.deletedIds : [];
    deletedIds.push(...batchDeletedIds);
  }

  return {
    deletedIds,
    deletedCount: deletedIds.length,
  };
}
