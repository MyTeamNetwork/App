const BULK_DELETE_CHUNK_SIZE = 100;

interface BulkDeleteChunkResponse {
  deletedIds?: string[];
}

interface BulkDeleteRequest {
  orgId: string;
  mediaIds: string[];
  fetchImpl?: typeof fetch;
}

export class BulkDeletePartialError extends Error {
  deletedIds: string[];
  failedIds: string[];

  constructor(message: string, deletedIds: string[], failedIds: string[]) {
    super(message);
    this.name = "BulkDeletePartialError";
    this.deletedIds = deletedIds;
    this.failedIds = failedIds;
  }
}

async function parseBulkDeleteError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  return data?.error || "Failed to delete";
}

export async function bulkDeleteSelectedMedia({
  orgId,
  mediaIds,
  fetchImpl = fetch,
}: BulkDeleteRequest): Promise<{ deletedIds: string[] }> {
  if (mediaIds.length === 0) {
    return { deletedIds: [] };
  }

  const deletedIds: string[] = [];

  for (let chunkIndex = 0; chunkIndex < mediaIds.length; chunkIndex += BULK_DELETE_CHUNK_SIZE) {
    const chunk = mediaIds.slice(chunkIndex, chunkIndex + BULK_DELETE_CHUNK_SIZE);
    const response = await fetchImpl("/api/media/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, mediaIds: chunk }),
    });

    if (!response.ok) {
      const message = await parseBulkDeleteError(response);
      if (deletedIds.length > 0) {
        throw new BulkDeletePartialError(message, deletedIds, mediaIds.slice(chunkIndex));
      }
      throw new Error(message);
    }

    const data = await response.json().catch(() => null) as BulkDeleteChunkResponse | null;
    deletedIds.push(...(data?.deletedIds ?? []));
  }

  return { deletedIds };
}

export function getBulkDeleteSuccessMessage(deletedCount: number): string {
  return `Deleted ${deletedCount} item${deletedCount === 1 ? "" : "s"}`;
}

export function getBulkDeletePartialFailureMessage(deletedCount: number, failedCount: number): string {
  return `Deleted ${deletedCount} item${deletedCount === 1 ? "" : "s"}; ${failedCount} failed`;
}
