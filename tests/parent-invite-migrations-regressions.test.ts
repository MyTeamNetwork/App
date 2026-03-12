import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

function getMigrationFiles(): string[] {
  return fs.readdirSync(migrationsDir).sort();
}

function getLatestRedeemParentInviteSql(): string {
  const files = getMigrationFiles();
  let latestSql = "";

  const pattern = /create or replace function public\.redeem_parent_invite\(p_code text\)[\s\S]*?\$\$;/i;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const match = sql.match(pattern);
    if (!match) continue;
    latestSql = match[0];
  }

  return latestSql;
}

function countMatches(input: string, pattern: RegExp): number {
  return Array.from(input.matchAll(pattern)).length;
}

test("redeem_parent_invite follow-up migrations sort after the current schema head", () => {
  const files = getMigrationFiles();
  const followUps = files.filter((file) =>
    /fix_redeem_parent_invite_revoked_branch|fix_redeem_parent_invite_claim_guard|grant_redeem_parent_invite/.test(file)
  );

  assert.equal(followUps.length, 3);
  for (const file of followUps) {
    assert.ok(
      file > "20260631000000_org_member_sync_skip_revoked.sql",
      `Expected ${file} to sort after 20260631000000_org_member_sync_skip_revoked.sql`
    );
  }
});

test("latest redeem_parent_invite uses LIMIT 1 for duplicate-prone parent lookups", () => {
  const sql = getLatestRedeemParentInviteSql();

  const byUserMatches = countMatches(
    sql,
    /from public\.parents[\s\S]*?organization_id = v_invite\.organization_id[\s\S]*?user_id = v_user_id[\s\S]*?deleted_at is null[\s\S]*?limit 1;/gi
  );
  const byEmailMatches = countMatches(
    sql,
    /from public\.parents[\s\S]*?organization_id = v_invite\.organization_id[\s\S]*?lower\(email\) = lower\(v_user_email\)[\s\S]*?deleted_at is null[\s\S]*?limit 1;/gi
  );

  assert.equal(byUserMatches, 2, "Expected LIMIT 1 on both org+user parent lookups");
  assert.equal(byEmailMatches, 2, "Expected LIMIT 1 on both org+email parent lookups");
});
