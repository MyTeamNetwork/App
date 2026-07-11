#!/usr/bin/env node
/**
 * Orphaned-membership check ("You are in no orgs" guard).
 *
 * Fails when an authenticated user would see NO organizations on the mobile app
 * (apps/mobile/src/hooks/useOrganizations.ts) despite an active membership
 * record saying they belong. The org list is driven entirely by rows in
 * public.user_organization_roles keyed on the logged-in user's id; a user with
 * zero rows there sees nothing.
 *
 * Two production failure modes are detected:
 *   A) Stranded on a duplicate account — a members/alumni row's email belongs to
 *      one account, but its user_id points at a DIFFERENT account (the org role
 *      landed there). The person logs in with the email account and sees nothing.
 *      This was g.demarrais@fdu.edu (coach/admin role stranded on a duplicate
 *      Google account).
 *   B) Org role never created — an active members row correctly points at the
 *      user's own account, but no user_organization_roles row was inserted.
 *
 * Small tables (members/alumni/users/roles are all < ~1k rows), so we pull them
 * via PostgREST and join in memory rather than adding a SECURITY DEFINER RPC.
 *
 * Soft-skip: when SUPABASE_SERVICE_ROLE_KEY / URL are unset (e.g. fork PRs with
 * no secrets), this exits 0 with a notice — matching check-migration-drift.js.
 *
 * Known-gap allowlist: KNOWN_STRANDED holds user ids deliberately left orphaned
 * (e.g. abandoned test orgs). Each entry MUST carry a reason. Remove an entry
 * once the user is fixed — a stale allowlist entry hides the next real bug.
 */

const { createClient } = require("@supabase/supabase-js");

// user_id -> reason. Keep reasons; delete entries once the user has an org role.
const KNOWN_STRANDED = new Map([
  // ["<user-uuid>", "abandoned test org 'My New Team in 2026!', not a real signup"],
]);

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function fetchAll(supabase, table, columns) {
  // Page through so we never silently truncate at PostgREST's 1000-row cap.
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.log(
      "⏭️  check-orphaned-memberships: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset — skipping (no DB credentials)."
    );
    process.exit(0);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const [users, roles, members, alumni] = await Promise.all([
    fetchAll(supabase, "users", "id, email"),
    fetchAll(supabase, "user_organization_roles", "user_id"),
    fetchAll(supabase, "members", "id, email, user_id, organization_id, status, role"),
    fetchAll(supabase, "alumni", "id, email, user_id, organization_id"),
  ]);

  const norm = (e) => (e || "").trim().toLowerCase();
  const usersById = new Map(users.map((u) => [u.id, u]));
  const accountsByEmail = new Map();
  for (const u of users) {
    const key = norm(u.email);
    if (!key) continue;
    if (!accountsByEmail.has(key)) accountsByEmail.set(key, []);
    accountsByEmail.get(key).push(u);
  }
  const usersWithRole = new Set(roles.map((r) => r.user_id));

  const findings = [];

  // Class A: membership row whose email owner account differs from its user_id.
  for (const [source, rows] of [
    ["members", members],
    ["alumni", alumni],
  ]) {
    for (const row of rows) {
      const owners = accountsByEmail.get(norm(row.email)) || [];
      const emailOwner = owners.find((o) => o.id !== row.user_id);
      if (emailOwner && !usersWithRole.has(emailOwner.id)) {
        findings.push({
          klass: "A",
          user_id: emailOwner.id,
          email: emailOwner.email,
          source,
          organization_id: row.organization_id,
          detail: `${source} record ${row.id} points at user ${row.user_id}, but the email owner ${emailOwner.id} has no org role`,
        });
      }
    }
  }

  // Class B: user with an active members record for their own email, no org role.
  for (const m of members) {
    if (m.status !== "active") continue;
    const owners = accountsByEmail.get(norm(m.email)) || [];
    for (const owner of owners) {
      if (usersWithRole.has(owner.id)) continue;
      findings.push({
        klass: "B",
        user_id: owner.id,
        email: owner.email,
        source: "members",
        organization_id: m.organization_id,
        detail: `active members record ${m.id} (role ${m.role || "?"}) but user has zero org roles`,
      });
    }
  }

  // De-dupe by (user_id, organization_id) and drop allowlisted users.
  const seen = new Set();
  const real = [];
  for (const f of findings) {
    if (KNOWN_STRANDED.has(f.user_id)) continue;
    const key = `${f.user_id}:${f.organization_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    real.push(f);
  }

  if (real.length === 0) {
    console.log(
      `✅ check-orphaned-memberships: no stranded users. ` +
        `Scanned ${users.length} users, ${members.length} members, ${alumni.length} alumni.`
    );
    process.exit(0);
  }

  console.error(
    `❌ check-orphaned-memberships: ${real.length} user(s) would see "no orgs" despite an active membership:\n`
  );
  for (const f of real) {
    const u = usersById.get(f.user_id);
    console.error(
      `  [Class ${f.klass}] ${u ? u.email : f.user_id} (user ${f.user_id})\n` +
        `      org ${f.organization_id} — ${f.detail}`
    );
  }
  console.error(
    `\nFix: repoint the membership/org role onto the account the user logs in with, ` +
      `or (Class B) create the missing user_organization_roles row. ` +
      `See supabase/check-orphaned-memberships.sql for the full diagnostic. ` +
      `Deliberate exceptions go in KNOWN_STRANDED with a reason.`
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(`check-orphaned-memberships failed: ${e.message}`);
  process.exit(1);
});
