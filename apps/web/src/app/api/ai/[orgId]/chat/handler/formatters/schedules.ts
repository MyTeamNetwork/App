export function formatExtractScheduleFileResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    state?: string;
    pending_actions?: unknown[];
    validation_errors?: Array<{ index: number; missing_fields: string[] }>;
    source_file?: unknown;
  };

  if (payload.state === "no_events_found") {
    return "I couldn't find any usable events in that schedule file. Try a clearer photo or upload a PDF export if you have one.";
  }

  if (payload.state === "missing_fields") {
    const errors = Array.isArray(payload.validation_errors) ? payload.validation_errors : [];
    const missingFields = [...new Set(errors.flatMap((error) => error.missing_fields))];

    if (missingFields.length === 0) {
      return "I could read the schedule file, but I need a few more event details before I can prepare anything for confirmation.";
    }

    return `I could read the schedule file, but I still need: ${missingFields.join(", ")} before I can prepare those events.`;
  }

  if (payload.state === "needs_batch_confirmation") {
    const count = Array.isArray(payload.pending_actions) ? payload.pending_actions.length : 0;
    const skipped = Array.isArray(payload.validation_errors) ? payload.validation_errors.length : 0;
    let message = `I drafted ${count} event${count === 1 ? "" : "s"} from that schedule file. Review the details below and confirm when you're ready.`;
    if (skipped > 0) {
      message += ` ${skipped} event${skipped === 1 ? "" : "s"} still need more details.`;
    }
    return message;
  }

  return null;
}

/**
 * CSV import variant. Reuses the schedule-file wording but speaks in terms of
 * the CSV and surfaces a truncation note when the file exceeded the row cap.
 */
export function formatImportEventsCsvResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    state?: string;
    pending_actions?: unknown[];
    validation_errors?: Array<{ index: number; missing_fields: string[] }>;
    truncated_count?: number;
  };

  if (payload.state === "no_events_found") {
    return "I couldn't find any events in that CSV. Make sure the first row is column headers and each row has at least an event name and date.";
  }

  if (payload.state === "missing_fields") {
    const errors = Array.isArray(payload.validation_errors) ? payload.validation_errors : [];
    const missingFields = [...new Set(errors.flatMap((error) => error.missing_fields))];

    if (missingFields.includes("start_date")) {
      return "I read the CSV, but I couldn't tell which column holds the event date. Add a clear date column (e.g. \"Date\" in YYYY-MM-DD or M/D/YYYY) and try again.";
    }

    if (missingFields.length === 0) {
      return "I could read the CSV, but I need a few more event details before I can prepare anything for confirmation.";
    }

    return `I could read the CSV, but I still need: ${missingFields.join(", ")} before I can prepare those events.`;
  }

  if (payload.state === "needs_batch_confirmation") {
    const count = Array.isArray(payload.pending_actions) ? payload.pending_actions.length : 0;
    const skipped = Array.isArray(payload.validation_errors) ? payload.validation_errors.length : 0;
    let message = `I mapped your CSV columns and drafted ${count} event${count === 1 ? "" : "s"}. Review the details below and confirm when you're ready.`;
    if (skipped > 0) {
      message += ` ${skipped} row${skipped === 1 ? "" : "s"} still need more details.`;
    }
    if (typeof payload.truncated_count === "number" && payload.truncated_count > 0) {
      message += ` I only imported the first ${count + skipped}; ${payload.truncated_count} additional row${payload.truncated_count === 1 ? " was" : "s were"} skipped to stay within the limit.`;
    }
    return message;
  }

  return null;
}
