// Shared utilities for bulk alumni import components

export interface ImportResultBase {
  updated: number;
  created: number;
  skipped: number;
  quotaBlocked: number;
  errors: string[];
}

export interface ImportSummary {
  willCreate: number;
  willUpdate: number;
  willSkip: number;
  quotaBlocked: number;
  invalid: number;
}

export function getResultClasses(r: ImportResultBase): { border: string; text: string } {
  if (r.updated > 0 || r.created > 0) return { border: "border-emerald-500/30 bg-emerald-500/10", text: "text-emerald-400" };
  if (r.quotaBlocked > 0) return { border: "border-amber-500/30 bg-amber-500/10", text: "text-amber-400" };
  return { border: "border-border bg-muted/50", text: "text-muted-foreground" };
}

export function summarizeRows<T extends { status: string }>(
  rows: T[],
  invalidStatuses: string[],
): ImportSummary {
  let willCreate = 0;
  let willUpdate = 0;
  let willSkip = 0;
  let quotaBlocked = 0;
  let invalid = 0;

  for (const row of rows) {
    if (row.status === "will_create") willCreate++;
    else if (row.status === "will_update") willUpdate++;
    else if (row.status === "will_skip") willSkip++;
    else if (row.status === "quota_blocked") quotaBlocked++;
    else if (invalidStatuses.includes(row.status)) invalid++;
  }

  return { willCreate, willUpdate, willSkip, quotaBlocked, invalid };
}
