// apps/web/scripts/backfill-linkedin-logos.ts
//
// One-off backfill: re-fetches LinkedIn profiles via Apify and rewrites
// enrichment through the repo's existing write-back code so expired
// media.licdn.com logo URLs in the DB get replaced with durable
// Supabase-storage URLs.
//
// Deliberately avoids the linkedin_enrichment_runs table so production's
// reconciliation cron/webhook (running old code) cannot race it - with no
// target rows recorded, prod's processFinishedApifyRun finds zero targets
// for our run IDs and no-ops.
//
// Usage (from apps/web/):
//   bun --env-file=../../.env.local run scripts/backfill-linkedin-logos.ts
//   bun --env-file=../../.env.local run scripts/backfill-linkedin-logos.ts --dry-run
//   bun --env-file=../../.env.local run scripts/backfill-linkedin-logos.ts --limit 10
//   bun --env-file=../../.env.local run scripts/backfill-linkedin-logos.ts --rewrite-stale
//   bun --env-file=../../.env.local run scripts/backfill-linkedin-logos.ts --rewrite-stale --dry-run
//   bun --env-file=../../.env.local run scripts/backfill-linkedin-logos.ts --run-ids <id1,id2>
//   bun --env-file=../../.env.local run scripts/backfill-linkedin-logos.ts --rewrite-stale --run-ids <id1,id2>

delete process.env.APIFY_WEBHOOK_SECRET;

import { createClient } from "@supabase/supabase-js";
import { normalizeLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";
import {
  fetchApifyRunDataset,
  fetchApimaestroEducationDates,
  getApifyProfileUrlKeys,
  getApifyRunStatus,
  isTerminalApifyRunStatus,
  mapApifyToFields,
  mergeEducationYears,
  startApifyProfileRun,
  type ApifyProfileResult,
} from "@/lib/linkedin/apify";
import { rehostProfileLogos, writeTarget, type RunTargetRow } from "@/lib/linkedin/enrichment-writeback";

const PREFIX = "[backfill-linkedin-logos]";
const LICDN_MARKER = "media.licdn.com";
const PAGE_SIZE = 1000;
const APIFY_CHUNK_SIZE = 100;
const POLL_INTERVAL_MS = 15_000;
const OVERALL_TIMEOUT_MS = 1_200_000;
const EDU_DATES_CONCURRENCY = 4;
const WRITE_CONCURRENCY = 2;

type AlumniTarget = {
  kind: "alumni";
  alumniId: string;
  organizationId: string;
  linkedinUrl: string;
};

type UserTarget = {
  kind: "user";
  userId: string;
  linkedinUrl: string;
};

type BackfillTarget = AlumniTarget | UserTarget;

type AlumniRow = {
  id: string;
  organization_id: string | null;
  linkedin_url: string | null;
  work_history: unknown;
  education_history: unknown;
  certifications: unknown;
  deleted_at: string | null;
};

type MemberRow = {
  id: string;
  user_id: string | null;
  linkedin_url: string | null;
  work_history: unknown;
  education_history: unknown;
  certifications: unknown;
  deleted_at: string | null;
};

type ConnectionRow = {
  user_id: string;
  linkedin_profile_url: string | null;
  linkedin_data: unknown;
};

type CliOptions = {
  dryRun: boolean;
  limit: number | null;
  runIds: string[] | null;
  rewriteStale: boolean;
};

function log(message: string, extra?: unknown): void {
  if (extra === undefined) {
    console.log(`${PREFIX} ${message}`);
  } else {
    console.log(`${PREFIX} ${message}`, extra);
  }
}

function error(message: string, extra?: unknown): void {
  if (extra === undefined) {
    console.error(`${PREFIX} ${message}`);
  } else {
    console.error(`${PREFIX} ${message}`, extra);
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, limit: null, runIds: null, rewriteStale: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--rewrite-stale") {
      options.rewriteStale = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[i + 1];
      const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
      if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== raw) {
        throw new Error("--limit requires a non-negative integer.");
      }
      options.limit = parsed;
      i += 1;
      continue;
    }
    if (arg === "--run-ids") {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith("--")) {
        throw new Error("--run-ids requires a comma-separated list of Apify run IDs.");
      }
      const runIds = raw
        ?.split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (!runIds || runIds.length === 0) {
        throw new Error("--run-ids requires a comma-separated list of Apify run IDs.");
      }
      options.runIds = runIds;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function safeNorm(url: string): string {
  try {
    return normalizeLinkedInProfileUrl(url);
  } catch {
    return url;
  }
}

function containsLicdnMarker(value: unknown): boolean {
  return (JSON.stringify(value) ?? "").includes(LICDN_MARKER);
}

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

async function fetchAllRows<T>(
  supabase: any,
  table: string,
  columns: string,
  apply?: (query: any) => any,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (apply) query = apply(query);

    const { data, error: queryError } = await query;
    if (queryError) {
      throw new Error(`Failed to read ${table}: ${queryError.message}`);
    }

    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function countRowsWithMarker(rows: unknown[], picker: (row: unknown) => unknown): number {
  return rows.filter((row) => containsLicdnMarker(picker(row))).length;
}

function getConnectionProfileUrl(row: ConnectionRow): string | null {
  if (row.linkedin_profile_url) return row.linkedin_profile_url;
  const data = row.linkedin_data as {
    enrichment?: { profile_url?: unknown; public_url?: unknown };
  } | null;
  const profileUrl = data?.enrichment?.profile_url;
  if (typeof profileUrl === "string" && profileUrl.trim() !== "") return profileUrl;
  const publicUrl = data?.enrichment?.public_url;
  if (typeof publicUrl === "string" && publicUrl.trim() !== "") return publicUrl;
  return null;
}

function buildDistinctUrls(targets: BackfillTarget[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const target of targets) {
    const key = safeNorm(target.linkedinUrl) || target.linkedinUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(key);
  }
  return urls;
}

function applyUrlLimit<T extends BackfillTarget>(targets: T[], limit: number | null): T[] {
  if (limit === null) return targets;

  const keptUrls = new Set<string>();
  const limited: T[] = [];
  for (const target of targets) {
    const key = safeNorm(target.linkedinUrl) || target.linkedinUrl;
    if (!keptUrls.has(key)) {
      if (keptUrls.size >= limit) continue;
      keptUrls.add(key);
    }
    limited.push(target);
  }
  return limited;
}

function rowHasStaleLogos(row: AlumniRow | MemberRow): boolean {
  return containsLicdnMarker({
    work_history: row.work_history,
    education_history: row.education_history,
    certifications: row.certifications,
  });
}

function buildDistinctRowUrls(rows: Array<AlumniRow | MemberRow>): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const row of rows) {
    if (!row.linkedin_url) continue;
    const key = safeNorm(row.linkedin_url) || row.linkedin_url;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(key);
  }
  return urls;
}

function applyRowUrlLimit<T extends AlumniRow | MemberRow>(rows: T[], limit: number | null): T[] {
  if (limit === null) return rows;

  const keptUrls = new Set<string>();
  const limited: T[] = [];
  for (const row of rows) {
    if (!row.linkedin_url) continue;
    const key = safeNorm(row.linkedin_url) || row.linkedin_url;
    if (!keptUrls.has(key)) {
      if (keptUrls.size >= limit) continue;
      keptUrls.add(key);
    }
    limited.push(row);
  }
  return limited;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getSucceededRunIds(distinctUrls: string[], providedRunIds: string[] | null): Promise<string[]> {
  if (providedRunIds) {
    log(`using provided Apify run IDs: ${providedRunIds.join(", ")}`);
    return providedRunIds;
  }

  const runIds: string[] = [];
  for (let i = 0; i < distinctUrls.length; i += APIFY_CHUNK_SIZE) {
    const chunk = distinctUrls.slice(i, i + APIFY_CHUNK_SIZE);
    const start = await startApifyProfileRun(chunk);
    if (!start.ok) {
      error(`failed to start Apify run: ${start.error}`);
      process.exit(1);
    }
    runIds.push(start.runId);
    log(`started Apify run ${start.runId}`);
  }

  const pending = new Set(runIds);
  const succeededRunIds: string[] = [];
  const startedAt = Date.now();

  while (pending.size > 0) {
    if (Date.now() - startedAt > OVERALL_TIMEOUT_MS) {
      error(`timeout waiting for runs: ${Array.from(pending).join(", ")}`);
      process.exit(1);
    }

    log(`polling: ${pending.size} runs pending`);
    await sleep(POLL_INTERVAL_MS);

    for (const runId of Array.from(pending)) {
      const status = await getApifyRunStatus(runId);
      if (!isTerminalApifyRunStatus(status)) continue;
      pending.delete(runId);
      log(`run ${runId} terminal status: ${status}`);
      if (status === "SUCCEEDED") {
        succeededRunIds.push(runId);
      }
    }
  }

  return succeededRunIds;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apifyToken = process.env.APIFY_API_TOKEN;
  const missing = [
    !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
    !key ? "SUPABASE_SERVICE_ROLE_KEY" : null,
    !apifyToken ? "APIFY_API_TOKEN" : null,
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    error(`missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!url || !key || !apifyToken) {
    error(`missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [alumniRows, memberRows, connectionRows] = await Promise.all([
    fetchAllRows<AlumniRow>(
      supabase,
      "alumni",
      "id, organization_id, linkedin_url, work_history, education_history, certifications, deleted_at",
      (query) => query.not("linkedin_url", "is", null),
    ),
    fetchAllRows<MemberRow>(
      supabase,
      "members",
      "id, user_id, linkedin_url, work_history, education_history, certifications, deleted_at",
      (query) => query.not("linkedin_url", "is", null),
    ),
    fetchAllRows<ConnectionRow>(supabase, "user_linkedin_connections", "user_id, linkedin_profile_url, linkedin_data"),
  ]);

  const before = {
    alumni: countRowsWithMarker(
      alumniRows,
      (row) => ({
        work_history: (row as AlumniRow).work_history,
        education_history: (row as AlumniRow).education_history,
        certifications: (row as AlumniRow).certifications,
      }),
    ),
    members: countRowsWithMarker(
      memberRows,
      (row) => ({
        work_history: (row as MemberRow).work_history,
        education_history: (row as MemberRow).education_history,
        certifications: (row as MemberRow).certifications,
      }),
    ),
    connections: countRowsWithMarker(connectionRows, (row) => (row as ConnectionRow).linkedin_data),
  };

  const staleAlumniRows = alumniRows.filter((row) => !row.deleted_at && row.linkedin_url && rowHasStaleLogos(row));
  const staleMemberRows = memberRows.filter((row) => !row.deleted_at && row.linkedin_url && rowHasStaleLogos(row));

  if (options.rewriteStale && options.dryRun) {
    log("dry-run summary");
    log(`Stale alumni rows count: ${staleAlumniRows.length}`);
    log(`Stale member rows count: ${staleMemberRows.length}`);
    process.exit(0);
  }

  const alumniTargets: AlumniTarget[] = [];
  for (const row of alumniRows) {
    if (
      !row.linkedin_url ||
      !row.organization_id ||
      !containsLicdnMarker({
        work_history: row.work_history,
        education_history: row.education_history,
        certifications: row.certifications,
      })
    ) {
      continue;
    }
    alumniTargets.push({
      kind: "alumni",
      alumniId: row.id,
      organizationId: row.organization_id,
      linkedinUrl: row.linkedin_url,
    });
  }

  const rawUserTargets: UserTarget[] = [];
  let skippedNoUserId = 0;
  for (const row of memberRows) {
    if (
      !row.linkedin_url ||
      !containsLicdnMarker({
        work_history: row.work_history,
        education_history: row.education_history,
        certifications: row.certifications,
      })
    ) {
      continue;
    }
    if (!row.user_id) {
      skippedNoUserId += 1;
      continue;
    }
    rawUserTargets.push({ kind: "user", userId: row.user_id, linkedinUrl: row.linkedin_url });
  }

  let skippedNoUrl = 0;
  for (const row of connectionRows) {
    if (!containsLicdnMarker(row.linkedin_data)) continue;
    const linkedinUrl = getConnectionProfileUrl(row);
    if (!linkedinUrl) {
      skippedNoUrl += 1;
      continue;
    }
    rawUserTargets.push({ kind: "user", userId: row.user_id, linkedinUrl });
  }

  const userTargets: UserTarget[] = [];
  const seenUserIds = new Set<string>();
  let deduplicatedUserTargets = 0;
  for (const target of rawUserTargets) {
    if (seenUserIds.has(target.userId)) {
      deduplicatedUserTargets += 1;
      continue;
    }
    seenUserIds.add(target.userId);
    userTargets.push(target);
  }

  const allTargetsBeforeLimit: BackfillTarget[] = [...alumniTargets, ...userTargets];
  const distinctUrlsBeforeLimit = buildDistinctUrls(allTargetsBeforeLimit);
  const limitedTargets = applyUrlLimit(allTargetsBeforeLimit, options.limit);
  const distinctUrls = buildDistinctUrls(limitedTargets);
  const limitedAlumniTargets = limitedTargets.filter((target): target is AlumniTarget => target.kind === "alumni");
  const limitedUserTargets = limitedTargets.filter((target): target is UserTarget => target.kind === "user");
  const allStaleRowsBeforeLimit = [...staleAlumniRows, ...staleMemberRows];
  const distinctStaleUrlsBeforeLimit = buildDistinctRowUrls(allStaleRowsBeforeLimit);
  const limitedStaleRows = applyRowUrlLimit(allStaleRowsBeforeLimit, options.limit);
  const limitedStaleAlumniRows = limitedStaleRows.filter((row): row is AlumniRow => "organization_id" in row);
  const limitedStaleMemberRows = limitedStaleRows.filter((row): row is MemberRow => "user_id" in row);
  const distinctStaleUrls = buildDistinctRowUrls(limitedStaleRows);
  const apifyUrls = options.rewriteStale ? distinctStaleUrls : distinctUrls;

  if (options.limit !== null) {
    const keptCount = options.rewriteStale ? distinctStaleUrls.length : distinctUrls.length;
    const truncatedCount = options.rewriteStale
      ? distinctStaleUrlsBeforeLimit.length - distinctStaleUrls.length
      : distinctUrlsBeforeLimit.length - distinctUrls.length;
    log(
      `--limit ${options.limit}: kept ${keptCount} distinct URLs, truncated ${truncatedCount}`,
    );
  }

  if (options.dryRun) {
    log("dry-run summary");
    log(`Alumni targets count: ${limitedAlumniTargets.length}`);
    log(`User targets count: ${limitedUserTargets.length}`);
    log(`Distinct URL count: ${distinctUrls.length}`);
    log(`Members rows skipped (no user_id): ${skippedNoUserId}`);
    log(`Connection rows skipped (no recoverable URL): ${skippedNoUrl}`);
    log(`Deduplicated user targets (overlap count): ${deduplicatedUserTargets}`);
    process.exit(0);
  }

  const succeededRunIds = await getSucceededRunIds(apifyUrls, options.runIds);

  const profiles: ApifyProfileResult[] = [];
  for (const runId of succeededRunIds) {
    const dataset = await fetchApifyRunDataset(runId);
    if (!dataset.ok) {
      error(`failed to fetch dataset for ${runId}: ${dataset.error}`);
      process.exit(1);
    }
    profiles.push(...dataset.profiles);
  }

  const byUrl = new Map<string, ApifyProfileResult>();
  for (const profile of profiles) {
    for (const key of getApifyProfileUrlKeys(profile)) {
      byUrl.set(key, profile);
    }
  }

  const profilesNeedingYears = profiles.filter(
    (profile) => profile.education.length > 0 && profile.education.some((edu) => !edu.start_year || !edu.end_year),
  );
  await mapWithConcurrency(profilesNeedingYears, EDU_DATES_CONCURRENCY, async (profile) => {
    const years = await fetchApimaestroEducationDates(profile.profile_url);
    mergeEducationYears(profile, years);
  });

  const logoCache = new Map<string, Promise<string | null>>();
  let writtenOk = 0;
  let writeFailed = 0;
  let unmatched = 0;
  let skippedNoFreshData = 0;
  const orderedTargets: BackfillTarget[] = [...limitedAlumniTargets, ...limitedUserTargets];

  if (options.rewriteStale) {
    const staleRowsToWrite = [...limitedStaleAlumniRows, ...limitedStaleMemberRows];
    log(
      `rewrite-stale: ${limitedStaleAlumniRows.length} alumni rows + ${limitedStaleMemberRows.length} member rows targeted`,
    );

    await mapWithConcurrency(staleRowsToWrite, WRITE_CONCURRENCY, async (row) => {
      const profile = byUrl.get(safeNorm(row.linkedin_url!)) ?? byUrl.get(row.linkedin_url!);
      if (!profile) {
        unmatched += 1;
        return;
      }

      await rehostProfileLogos(supabase, profile, logoCache);
      const fields = mapApifyToFields(profile);
      if (!isNonEmpty(fields.work_history) && isNonEmpty(row.work_history)) {
        skippedNoFreshData += 1;
        return;
      }

      const table = "organization_id" in row ? "alumni" : "members";
      const { error: updateError } = await supabase
        .from(table)
        .update({
          work_history: fields.work_history,
          education_history: fields.education_history,
          certifications: fields.certifications,
        })
        .eq("id", row.id);

      if (updateError) {
        writeFailed += 1;
      } else {
        writtenOk += 1;
      }
    });
  } else {
    await mapWithConcurrency(orderedTargets, WRITE_CONCURRENCY, async (target) => {
      const profile = byUrl.get(safeNorm(target.linkedinUrl)) ?? byUrl.get(target.linkedinUrl);
      if (!profile) {
        unmatched += 1;
        return;
      }

      const row: RunTargetRow =
        target.kind === "alumni"
          ? {
              id: "backfill",
              run_id: "backfill",
              target_kind: "alumni",
              user_id: null,
              alumni_id: target.alumniId,
              organization_id: target.organizationId,
              linkedin_url: target.linkedinUrl,
              status: "syncing",
            }
          : {
              id: "backfill",
              run_id: "backfill",
              target_kind: "user",
              user_id: target.userId,
              alumni_id: null,
              organization_id: null,
              linkedin_url: target.linkedinUrl,
              status: "syncing",
            };

      const ok = await writeTarget(supabase, row, profile, logoCache);
      if (ok) {
        writtenOk += 1;
      } else {
        writeFailed += 1;
      }
    });
  }

  const [afterAlumniRows, afterMemberRows, afterConnectionRows] = await Promise.all([
    fetchAllRows<AlumniRow>(
      supabase,
      "alumni",
      "id, organization_id, linkedin_url, work_history, education_history, certifications, deleted_at",
      (query) => query.not("linkedin_url", "is", null),
    ),
    fetchAllRows<MemberRow>(
      supabase,
      "members",
      "id, user_id, linkedin_url, work_history, education_history, certifications, deleted_at",
      (query) => query.not("linkedin_url", "is", null),
    ),
    fetchAllRows<ConnectionRow>(supabase, "user_linkedin_connections", "user_id, linkedin_profile_url, linkedin_data"),
  ]);

  const after = {
    alumni: countRowsWithMarker(
      afterAlumniRows,
      (row) => ({
        work_history: (row as AlumniRow).work_history,
        education_history: (row as AlumniRow).education_history,
        certifications: (row as AlumniRow).certifications,
      }),
    ),
    members: countRowsWithMarker(
      afterMemberRows,
      (row) => ({
        work_history: (row as MemberRow).work_history,
        education_history: (row as MemberRow).education_history,
        certifications: (row as MemberRow).certifications,
      }),
    ),
    connections: countRowsWithMarker(afterConnectionRows, (row) => (row as ConnectionRow).linkedin_data),
  };

  log("=== BACKFILL COMPLETE ===");
  log(
    `targets processed: ${
      options.rewriteStale ? limitedStaleAlumniRows.length + limitedStaleMemberRows.length : orderedTargets.length
    }`,
  );
  log(`written OK: ${writtenOk}`);
  log(`write-failed: ${writeFailed}`);
  log(`unmatched: ${unmatched}`);
  if (options.rewriteStale) {
    log(`skipped (no fresh data): ${skippedNoFreshData}`);
  }
  log(`skipped (no user_id): ${skippedNoUserId}`);
  log(`skipped (no url): ${skippedNoUrl}`);
  log(`Before: alumni=${before.alumni} members=${before.members} connections=${before.connections} rows with ${LICDN_MARKER}`);
  log(`After:  alumni=${after.alumni} members=${after.members} connections=${after.connections} rows with ${LICDN_MARKER}`);

  process.exit(writeFailed === 0 ? 0 : 1);
}

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
