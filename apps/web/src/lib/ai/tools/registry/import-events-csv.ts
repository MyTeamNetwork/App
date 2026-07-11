import { z } from "zod";
import type { AiLogContext } from "@/lib/ai/logger";
import { aiLog } from "@/lib/ai/logger";
import { isOwnedScheduleUploadPath } from "@/lib/ai/schedule-upload-path";
import {
  inferCsvEventColumnMapping,
  CSV_EVENT_FIELDS,
  type CsvEventColumnMapping,
} from "@/lib/ai/csv-event-mapping";
import {
  normalizeDateValue,
  normalizeEventType,
  normalizeTimeValue,
} from "@/lib/ai/schedule-extraction";
import { detectDelimiter, parseRfc4180 } from "@/lib/alumni/csv-import";
import { createEventPendingActionsFromDrafts } from "@/lib/ai/tools/prepare-tool-helpers";
import { getSafeErrorMessage, isCsvAttachment } from "@/lib/ai/tools/shared";
import type { PrepareEventArgs } from "@/lib/ai/tools/definitions";
import { toolError } from "@/lib/ai/tools/result";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import type { ToolModule } from "./types";

const importEventsCsvSchema = z.object({}).strict();

type Args = z.infer<typeof importEventsCsvSchema>;

const SCHEDULE_UPLOAD_BUCKET = "ai-schedule-uploads";
const MAX_CSV_ROWS = 100;
const SAMPLE_ROW_COUNT = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

async function deleteScheduleUpload(
  sb: SB,
  storagePath: string,
  logContext: AiLogContext
): Promise<void> {
  try {
    const { error } = await sb.storage.from(SCHEDULE_UPLOAD_BUCKET).remove([storagePath]);
    if (error) {
      aiLog("warn", "ai-tools", "import_events_csv cleanup failed", logContext, {
        error: getSafeErrorMessage(error),
        storagePath,
      });
    }
  } catch (error) {
    aiLog("warn", "ai-tools", "import_events_csv cleanup failed", logContext, {
      error: getSafeErrorMessage(error),
      storagePath,
    });
  }
}

function isNonEmptyRow(row: string[]): boolean {
  return row.some((cell) => cell.trim().length > 0);
}

function buildDraft(
  headerIndex: Map<string, number>,
  mapping: CsvEventColumnMapping,
  row: string[]
): PrepareEventArgs {
  const cell = (field: (typeof CSV_EVENT_FIELDS)[number]): string | undefined => {
    const header = mapping[field];
    if (!header) return undefined;
    const idx = headerIndex.get(header);
    if (idx == null) return undefined;
    const value = (row[idx] ?? "").trim();
    return value.length > 0 ? value : undefined;
  };

  return {
    title: cell("title"),
    description: cell("description"),
    start_date: normalizeDateValue(cell("start_date")),
    start_time: normalizeTimeValue(cell("start_time")),
    end_date: normalizeDateValue(cell("end_date")),
    end_time: normalizeTimeValue(cell("end_time")),
    location: cell("location"),
    event_type: normalizeEventType(cell("event_type")),
  };
}

export const importEventsCsvModule: ToolModule<Args> = {
  name: "import_events_csv",
  argsSchema: importEventsCsvSchema,
  async execute(args, { ctx, sb, logContext }) {
    void args;
    if (!ctx.threadId) {
      return toolError("Event preparation requires a thread context");
    }

    if (!ctx.attachment || !isCsvAttachment(ctx.attachment)) {
      return toolError("CSV attachment required", "attachment_required");
    }
    const attachment = ctx.attachment;

    if (!isOwnedScheduleUploadPath(ctx.orgId, ctx.userId, attachment.storagePath)) {
      aiLog("warn", "ai-tools", "import_events_csv invalid storage path", logContext, {
        storagePath: attachment.storagePath,
      });
      return toolError("Invalid schedule attachment path", "invalid_attachment_path");
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug, name")
      .eq("id", ctx.orgId)
      .maybeSingle();

    if (orgError) {
      aiLog("warn", "ai-tools", "import_events_csv org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context", "org_context_failed");
    }

    try {
      const { data: file, error: downloadError } = await sb.storage
        .from(SCHEDULE_UPLOAD_BUCKET)
        .download(attachment.storagePath);

      if (downloadError || !file) {
        aiLog("warn", "ai-tools", "import_events_csv download failed", logContext, {
          error: getSafeErrorMessage(downloadError),
          storagePath: attachment.storagePath,
        });
        return toolError("Unable to load attached schedule file", "attachment_unavailable");
      }

      const text = Buffer.from(await file.arrayBuffer()).toString("utf-8").trim();
      if (text.length === 0) {
        return { kind: "ok", data: { state: "no_events_found", source_file: attachment.fileName } };
      }

      const records = parseRfc4180(text, detectDelimiter(text));
      const headers = records[0]?.map((h) => h.trim()) ?? [];
      const dataRows = records.slice(1).filter(isNonEmptyRow);

      if (headers.length === 0 || dataRows.length === 0) {
        return { kind: "ok", data: { state: "no_events_found", source_file: attachment.fileName } };
      }

      const truncatedCount = Math.max(0, dataRows.length - MAX_CSV_ROWS);
      const boundedRows = dataRows.slice(0, MAX_CSV_ROWS);

      let mapping: CsvEventColumnMapping;
      try {
        mapping = await inferCsvEventColumnMapping({
          headers,
          sampleRows: boundedRows.slice(0, SAMPLE_ROW_COUNT),
          context: {
            orgName: typeof org?.name === "string" ? org.name : undefined,
            orgId: ctx.orgId,
            spendBypass: ctx.aiSpendBypass,
          },
        });
      } catch (error) {
        if (isStageTimeoutError(error)) {
          throw error;
        }
        aiLog("warn", "ai-tools", "import_events_csv mapping failed", logContext, {
          error: getSafeErrorMessage(error),
          storagePath: attachment.storagePath,
        });
        return toolError("Unable to map CSV columns to events", "csv_unreadable");
      }

      if (!mapping.start_date) {
        return {
          kind: "ok",
          data: {
            state: "missing_fields",
            validation_errors: [{ index: 0, missing_fields: ["start_date"], draft: {} }],
            truncated_count: truncatedCount > 0 ? truncatedCount : undefined,
          },
        };
      }

      // First index wins for duplicate headers.
      const headerIndex = new Map<string, number>();
      headers.forEach((header, i) => {
        if (!headerIndex.has(header)) headerIndex.set(header, i);
      });

      const drafts = boundedRows.map((row) => buildDraft(headerIndex, mapping, row));

      const { pendingActions, validationErrors } = await createEventPendingActionsFromDrafts(
        sb,
        ctx,
        drafts,
        logContext,
        typeof org?.slug === "string" ? org.slug : null
      );

      if (pendingActions.length === 0) {
        return {
          kind: "ok",
          data: {
            state: "missing_fields",
            validation_errors: validationErrors,
            truncated_count: truncatedCount > 0 ? truncatedCount : undefined,
          },
        };
      }

      return {
        kind: "ok",
        data: {
          state: "needs_batch_confirmation",
          pending_actions: pendingActions,
          validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
          truncated_count: truncatedCount > 0 ? truncatedCount : undefined,
        },
      };
    } finally {
      await deleteScheduleUpload(sb, attachment.storagePath, logContext);
    }
  },
};
