// ---------------------------------------------------------------------------
// Apify run write-back: shared by the apify-webhook and the reconciliation cron.
//
// Every started run records its target rows in `linkedin_enrichment_runs`. When
// a run finishes we fetch its dataset and match each profile back to a target by
// normalized LinkedIn URL, then write via the appropriate RPC.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  fetchApifyRunDataset,
  mapApifyToFields,
  getApifyProfileUrlKeys,
  fetchApimaestroEducationDates,
  mergeEducationYears,
  type ApifyProfileResult,
} from "@/lib/linkedin/apify";
import { normalizeLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";

interface RunTargetRow {
  id: string;
  run_id: string;
  target_kind: "user" | "alumni";
  user_id: string | null;
  alumni_id: string | null;
  organization_id: string | null;
  linkedin_url: string;
  status: string;
}

export interface ProcessRunResult {
  enriched: number;
  failed: number;
  unmatched: number;
}

function safeNormalize(url: string | null): string | null {
  if (!url) return null;
  try {
    return normalizeLinkedInProfileUrl(url);
  } catch {
    return null;
  }
}

const PHOTO_BUCKET = "linkedin-photos";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function photoExtFromContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

/**
 * Downloads a LinkedIn/Apify profile photo (whose source URL expires within days)
 * and stores a durable copy in the `linkedin-photos` bucket. Returns the public
 * URL, or null on any failure — the caller falls back to the source URL.
 * Path convention: `<kind>/<id>.<ext>` (UUID-named, upserted on re-sync).
 */
async function storeProfilePhoto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sourceUrl: string,
  kind: "alumni" | "user",
  id: string,
): Promise<string | null> {
  return storeRemoteImage(supabase, sourceUrl, (contentType) => `${kind}/${id}.${photoExtFromContentType(contentType)}`);
}

/**
 * Shared download/validate/upload core for expiring LinkedIn image URLs.
 * `pathFor` receives the response content-type — profile photos derive their
 * file extension from it, logos use a fixed content-hash path.
 */
async function storeRemoteImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sourceUrl: string,
  pathFor: (contentType: string) => string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchFn(sourceUrl);
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    if (!contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_PHOTO_BYTES) return null;
    const path = pathFor(contentType);
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) {
      console.error("[enrichment-writeback] photo upload failed:", error);
      return null;
    }
    const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (err) {
    console.error("[enrichment-writeback] photo download/store failed:", err);
    return null;
  }
}

export function isDurableImageUrl(url: string): boolean {
  return url.includes("/storage/v1/object/public/");
}

export function logoStoragePath(url: string): string | null {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  try {
    const parsed = new URL(url);
    const key = parsed.origin + parsed.pathname;
    return "logos/" + createHash("sha256").update(key).digest("hex");
  } catch {
    return null;
  }
}

const LOGO_CONCURRENCY = 4;

export async function rehostProfileLogos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  profile: ApifyProfileResult,
  cache: Map<string, Promise<string | null>>,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  type LogoSlot = { obj: Record<string, string | null>; field: string };
  const slots: LogoSlot[] = [];

  for (const exp of profile.experience ?? []) {
    slots.push({ obj: exp as unknown as Record<string, string | null>, field: "company_logo_url" });
  }
  for (const edu of profile.education ?? []) {
    slots.push({ obj: edu as unknown as Record<string, string | null>, field: "institute_logo_url" });
  }
  for (const cert of profile.certifications ?? []) {
    slots.push({ obj: cert as unknown as Record<string, string | null>, field: "logo_url" });
  }

  const toProcess = slots.filter(({ obj, field }) => {
    const url = obj[field];
    if (!url) return false;
    if (isDurableImageUrl(url)) return false;
    if (!logoStoragePath(url)) return false;
    return true;
  });

  for (let i = 0; i < toProcess.length; i += LOGO_CONCURRENCY) {
    const batch = toProcess.slice(i, i + LOGO_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ obj, field }) => {
        const url = obj[field]!;
        const path = logoStoragePath(url)!;

        if (!cache.has(path)) {
          const promise = (async (): Promise<string | null> => {
            const { data: publicUrlData } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
            const publicUrl: string | null = publicUrlData?.publicUrl ?? null;
            if (publicUrl) {
              try {
                const headRes = await fetchFn(publicUrl, { method: "HEAD" });
                if (headRes.ok) return publicUrl;
              } catch {
                // Fall through to download.
              }
            }
            return storeRemoteImage(supabase, url, () => path, fetchFn);
          })();
          cache.set(path, promise);
        }

        const durableUrl = await cache.get(path)!;
        if (durableUrl) {
          obj[field] = durableUrl;
        }
      }),
    );
  }
}

/**
 * Processes a finished Apify run: matches dataset profiles to the run's target
 * rows and writes enrichment for each. Idempotent — only acts on rows still
 * `syncing`. Returns counts. Never throws.
 */
export async function processFinishedApifyRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database> | any,
  runId: string,
): Promise<ProcessRunResult> {
  const result: ProcessRunResult = { enriched: 0, failed: 0, unmatched: 0 };

  const { data: targetData, error: targetError } = await supabase
    .from("linkedin_enrichment_runs")
    .select("id, run_id, target_kind, user_id, alumni_id, organization_id, linkedin_url, status")
    .eq("run_id", runId)
    .eq("status", "syncing");

  if (targetError) {
    console.error("[enrichment-writeback] failed to load run targets:", targetError);
    return result;
  }

  const targets = (targetData as RunTargetRow[] | null) ?? [];
  if (targets.length === 0) return result;

  const dataset = await fetchApifyRunDataset(runId);
  if (!dataset.ok) {
    // Leave rows 'syncing' so the reconciliation cron can retry; mark failed only
    // on a definitive provider rejection.
    if (dataset.kind === "unauthorized" || dataset.kind === "malformed_payload") {
      await markTargetsFailed(supabase, targets, dataset.error);
      result.failed += targets.length;
    }
    return result;
  }

  const profiles = dataset.profiles;
  const byUrl = new Map<string, ApifyProfileResult>();
  const logoCache = new Map<string, Promise<string | null>>();
  for (const profile of profiles) {
    for (const key of getApifyProfileUrlKeys(profile)) {
      byUrl.set(key, profile);
    }
  }

  // Hybrid supplement: the primary actor leaves education years null, so fetch
  // them from apimaestro (best-effort) and merge in place before mapping. Only
  // for profiles that actually have an education row missing years. Throttled —
  // apimaestro's run-sync counts against the Apify account's concurrent-run cap,
  // so a wide bulk run would silently fail most calls if fired all at once.
  const profilesNeedingYears = profiles.filter(
    (p) => p.education.length > 0 && p.education.some((e) => !e.start_year || !e.end_year),
  );
  const EDU_DATES_CONCURRENCY = 4;
  for (let i = 0; i < profilesNeedingYears.length; i += EDU_DATES_CONCURRENCY) {
    const batch = profilesNeedingYears.slice(i, i + EDU_DATES_CONCURRENCY);
    await Promise.all(
      batch.map(async (profile) => {
        const years = await fetchApimaestroEducationDates(profile.profile_url);
        mergeEducationYears(profile, years);
      }),
    );
  }

  for (const target of targets) {
    let profile = byUrl.get(safeNormalize(target.linkedin_url) ?? "");
    // Single-target / single-profile runs: the actor may not echo the input URL.
    if (!profile && targets.length === 1 && profiles.length === 1) {
      profile = profiles[0];
    }

    if (!profile) {
      // Diagnostic: a finished run returned profiles but none matched this
      // target's URL key. Log both sides so a recurring URL-shape divergence is
      // visible instead of silently failing the row (no PII — keys only).
      console.error("[enrichment-writeback] no_matching_profile", {
        runId,
        targetId: target.id,
        targetKind: target.target_kind,
        targetKey: safeNormalize(target.linkedin_url),
        availableKeys: Array.from(byUrl.keys()),
      });
      await markTargetsFailed(supabase, [target], "no_matching_profile");
      result.unmatched += 1;
      result.failed += 1;
      continue;
    }

    const ok = await writeTarget(supabase, target, profile, logoCache);
    if (ok) {
      await supabase
        .from("linkedin_enrichment_runs")
        .update({ status: "enriched", error: null, updated_at: new Date().toISOString() })
        .eq("id", target.id);
      result.enriched += 1;
    } else {
      await markTargetsFailed(supabase, [target], "write_failed");
      result.failed += 1;
    }
  }

  return result;
}

async function writeTarget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  target: RunTargetRow,
  profile: ApifyProfileResult,
  logoCache: Map<string, Promise<string | null>>,
): Promise<boolean> {
  await rehostProfileLogos(supabase, profile, logoCache);
  const fields = mapApifyToFields(profile);

  if (target.target_kind === "alumni") {
    if (!target.alumni_id || !target.organization_id) return false;
    // Persist a durable copy of the (expiring) source photo before writing.
    const durablePhotoUrl = fields.photo_url
      ? await storeProfilePhoto(supabase, fields.photo_url, "alumni", target.alumni_id)
      : null;
    const { error } = await supabase.rpc("enrich_alumni_by_id", {
      p_alumni_id: target.alumni_id,
      p_organization_id: target.organization_id,
      p_job_title: fields.job_title,
      p_current_company: fields.current_company,
      p_current_city: fields.current_city,
      p_school: fields.school,
      p_major: fields.major,
      p_position_title: fields.position_title,
      p_headline: fields.headline,
      p_summary: fields.summary,
      p_work_history: fields.work_history as unknown,
      p_education_history: fields.education_history as unknown,
      p_industry: fields.industry,
      p_photo_url: durablePhotoUrl ?? fields.photo_url,
      p_skills: fields.skills as unknown,
      p_certifications: fields.certifications as unknown,
      p_languages: fields.languages as unknown,
    });
    if (error) {
      console.error("[enrichment-writeback] enrich_alumni_by_id error:", error);
      return false;
    }
    return true;
  }

  // target_kind === 'user'
  if (!target.user_id) return false;
  const durablePhotoUrl = fields.photo_url
    ? await storeProfilePhoto(supabase, fields.photo_url, "user", target.user_id)
    : null;
  const { error } = await supabase.rpc("sync_user_linkedin_enrichment", {
    p_user_id: target.user_id,
    p_job_title: fields.job_title,
    p_current_company: fields.current_company,
    p_current_city: fields.current_city,
    p_school: fields.school,
    p_major: fields.major,
    p_position_title: fields.position_title,
    p_enrichment_json: profile as unknown,
    p_headline: fields.headline,
    p_summary: fields.summary,
    p_work_history: fields.work_history as unknown,
    p_education_history: fields.education_history as unknown,
    p_overwrite: true,
    p_industry: fields.industry,
    p_photo_url: durablePhotoUrl ?? fields.photo_url,
    p_skills: fields.skills as unknown,
    p_certifications: fields.certifications as unknown,
    p_languages: fields.languages as unknown,
  });
  if (error) {
    console.error("[enrichment-writeback] sync_user_linkedin_enrichment error:", error);
    return false;
  }

  // Reflect completion on the connection (for self-sync UI status).
  await supabase
    .from("user_linkedin_connections")
    .update({
      enrichment_status: "enriched",
      enrichment_run_id: null,
      last_synced_at: new Date().toISOString(),
      sync_error: null,
    })
    .eq("user_id", target.user_id)
    .eq("enrichment_run_id", target.run_id);

  return true;
}

async function markTargetsFailed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  targets: RunTargetRow[],
  error: string,
): Promise<void> {
  if (targets.length === 0) return;
  const ids = targets.map((t) => t.id);
  await supabase
    .from("linkedin_enrichment_runs")
    .update({ status: "failed", error, updated_at: new Date().toISOString() })
    .in("id", ids);

  // Surface failure on alumni rows + user connections so the UI/queue reflect it.
  const alumniIds = targets.filter((t) => t.target_kind === "alumni" && t.alumni_id).map((t) => t.alumni_id);
  if (alumniIds.length > 0) {
    await supabase.rpc("increment_enrichment_retry", {
      p_alumni_ids: alumniIds,
      p_error: error,
      p_max_retries: 3,
    });
  }
  const userTargets = targets.filter((t) => t.target_kind === "user" && t.user_id);
  for (const target of userTargets) {
    await supabase
      .from("user_linkedin_connections")
      .update({ enrichment_status: "failed", enrichment_run_id: null, sync_error: error })
      .eq("user_id", target.user_id)
      .eq("enrichment_run_id", target.run_id);
  }
}

/**
 * Best-effort: marks alumni rows `pending` so the enrichment-process cron starts
 * an Apify run for them. Only rows that already have a `linkedin_url` and aren't
 * already enriched / in-flight are enqueued. Never throws — callers (e.g. the
 * Blackbaud sync) must not fail because enrichment enqueueing failed.
 */
export async function enqueueAlumniForEnrichment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  organizationId: string,
  alumniIds: string[],
): Promise<{ enqueued: number }> {
  const ids = Array.from(new Set(alumniIds)).filter(Boolean);
  if (ids.length === 0) return { enqueued: 0 };

  let enqueued = 0;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    try {
      const { data, error } = await supabase
        .from("alumni")
        .update({ enrichment_status: "pending", enrichment_retry_count: 0, enrichment_error: null })
        .eq("organization_id", organizationId)
        .in("id", chunk)
        .not("linkedin_url", "is", null)
        .or("enrichment_status.is.null,enrichment_status.eq.failed")
        .select("id");
      if (error) {
        console.error("[enrichment-writeback] enqueueAlumniForEnrichment error:", error);
        continue;
      }
      enqueued += (data ?? []).length;
    } catch (err) {
      console.error("[enrichment-writeback] enqueueAlumniForEnrichment failed:", err);
    }
  }
  return { enqueued };
}

/**
 * Records the rows a freshly-started run will write back to. `targets` describe
 * either a single alumni row or a user_id whose profiles should be synced.
 */
export async function recordRunTargets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  runId: string,
  targets: Array<
    | { kind: "alumni"; alumniId: string; organizationId: string; linkedinUrl: string }
    | { kind: "user"; userId: string; linkedinUrl: string }
  >,
): Promise<void> {
  if (targets.length === 0) return;
  const rows = targets.map((t) =>
    t.kind === "alumni"
      ? {
          run_id: runId,
          target_kind: "alumni",
          alumni_id: t.alumniId,
          organization_id: t.organizationId,
          linkedin_url: t.linkedinUrl,
          status: "syncing",
        }
      : {
          run_id: runId,
          target_kind: "user",
          user_id: t.userId,
          linkedin_url: t.linkedinUrl,
          status: "syncing",
        },
  );
  const { error } = await supabase.from("linkedin_enrichment_runs").insert(rows);
  if (error) console.error("[enrichment-writeback] failed to record run targets:", error);
}
