import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolName } from "./definitions.ts";
import { TOOL_NAMES } from "./definitions.ts";

export interface ToolExecutionContext {
  orgId: string;
  serviceSupabase: SupabaseClient;
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

// --- Zod schemas for tool argument validation ---

const listMembersSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const listEventsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    upcoming: z.boolean().optional(),
  })
  .strict();

const getOrgStatsSchema = z.object({}).strict();

const ARG_SCHEMAS: Record<ToolName, z.ZodSchema> = {
  list_members: listMembersSchema,
  list_events: listEventsSchema,
  get_org_stats: getOrgStatsSchema,
};

function validateArgs(
  name: ToolName,
  raw: unknown
): { valid: true; args: unknown } | { valid: false; error: string } {
  const schema = ARG_SCHEMAS[name];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      error: `Invalid tool arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    };
  }
  return { valid: true, args: parsed.data };
}

async function safeToolQuery(
  fn: () => Promise<{ data: unknown; error: unknown }>
): Promise<ToolResult> {
  try {
    const { data, error } = await fn();
    if (error) {
      console.warn("[ai-tools] query failed:", error);
      return { ok: false, error: "Query failed" };
    }
    return { ok: true, data: data ?? [] };
  } catch (err) {
    console.warn("[ai-tools] unexpected error:", err);
    return { ok: false, error: "Unexpected error" };
  }
}

async function safeToolCount(
  fn: () => Promise<{ count: number | null; error: unknown }>
): Promise<number | null> {
  try {
    const { count, error } = await fn();
    if (error || count === null) return null;
    return count;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

async function listMembers(
  sb: SB,
  orgId: string,
  args: z.infer<typeof listMembersSchema>
): Promise<ToolResult> {
  const limit = Math.min(args.limit ?? 20, 50);
  return safeToolQuery(() =>
    sb
      .from("members")
      .select("id, user_id, status, role, joined_at, users(name, email)")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .eq("status", "active")
      .order("joined_at", { ascending: false })
      .limit(limit)
  );
}

async function listEvents(
  sb: SB,
  orgId: string,
  args: z.infer<typeof listEventsSchema>
): Promise<ToolResult> {
  const limit = Math.min(args.limit ?? 10, 25);
  const upcoming = args.upcoming ?? true;
  const now = new Date().toISOString();
  return safeToolQuery(() => {
    let query = sb
      .from("events")
      .select("id, title, start_date, end_date, location, description")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("start_date", { ascending: upcoming })
      .limit(limit);
    if (upcoming) {
      query = query.gte("start_date", now);
    }
    return query;
  });
}

async function getOrgStats(sb: SB, orgId: string): Promise<ToolResult> {
  const [members, alumni, parents, upcomingEvents, donations] = await Promise.all([
    safeToolCount(() =>
      sb
        .from("members")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .eq("status", "active")
    ),
    safeToolCount(() =>
      sb
        .from("alumni")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
    ),
    safeToolCount(() =>
      sb
        .from("parents")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
    ),
    safeToolCount(() =>
      sb
        .from("events")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .gte("start_date", new Date().toISOString())
    ),
    safeToolQuery(() =>
      sb
        .from("organization_donation_stats")
        .select("total_amount_cents, donation_count, last_donation_at")
        .eq("organization_id", orgId)
        .maybeSingle()
    ),
  ]);

  return {
    ok: true,
    data: {
      active_members: members,
      alumni,
      parents,
      upcoming_events: upcomingEvents,
      donations: donations.ok ? donations.data : null,
    },
  };
}

export async function executeToolCall(
  ctx: ToolExecutionContext,
  call: { name: string; args: unknown }
): Promise<ToolResult> {
  if (!TOOL_NAMES.has(call.name)) {
    return { ok: false, error: `Unknown tool: ${call.name}` };
  }
  const toolName = call.name as ToolName;

  const validation = validateArgs(toolName, call.args);
  if (!validation.valid) return { ok: false, error: validation.error };
  const args = validation.args;

  const sb = ctx.serviceSupabase;

  switch (toolName) {
    case "list_members":
      return listMembers(sb, ctx.orgId, args as z.infer<typeof listMembersSchema>);
    case "list_events":
      return listEvents(sb, ctx.orgId, args as z.infer<typeof listEventsSchema>);
    case "get_org_stats":
      return getOrgStats(sb, ctx.orgId);
  }
}
