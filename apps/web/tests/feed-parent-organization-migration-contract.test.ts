import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20270104000000_enforce_feed_parent_organization.sql",
    import.meta.url
  ),
  "utf8"
);
const normalized = migration.replace(/\s+/g, " ");

function insertPolicy(table: "feed_comments" | "feed_likes"): string {
  const policyName = `${table}_insert`;
  const match = normalized.match(
    new RegExp(
      `CREATE POLICY "${policyName}" ON public\\.${table} FOR INSERT WITH CHECK \\(([\\s\\S]*?)\\);`,
      "i"
    )
  );
  assert.ok(match, `missing ${policyName} INSERT policy`);
  return match[1];
}

function commentUpdateCheck(): string {
  const match = normalized.match(
    /CREATE POLICY "feed_comments_update" ON public\.feed_comments FOR UPDATE[\s\S]*?WITH CHECK \(([\s\S]*?)\);/i
  );
  assert.ok(match, "missing feed_comments_update policy");
  return match[1];
}

describe("feed child organization RLS migration contract", () => {
  it("keeps parent-role support and binds comments to the parent post organization", () => {
    const policy = insertPolicy("feed_comments");

    assert.match(policy, /'admin','active_member','alumni','parent'/i);
    assert.match(policy, /EXISTS \( SELECT 1 FROM public\.feed_posts AS post/i);
    assert.match(policy, /post\.id = feed_comments\.post_id/i);
    assert.match(policy, /post\.organization_id = feed_comments\.organization_id/i);
    assert.match(policy, /post\.deleted_at IS NULL/i);
  });

  it("keeps parent-role support and binds likes to the parent post organization", () => {
    const policy = insertPolicy("feed_likes");

    assert.match(policy, /'admin','active_member','alumni','parent'/i);
    assert.match(policy, /EXISTS \( SELECT 1 FROM public\.feed_posts AS post/i);
    assert.match(policy, /post\.id = feed_likes\.post_id/i);
    assert.match(policy, /post\.organization_id = feed_likes\.organization_id/i);
    assert.match(policy, /post\.deleted_at IS NULL/i);
  });

  it("prevents authors from re-parenting comments across organizations via UPDATE", () => {
    const check = commentUpdateCheck();

    assert.match(check, /author_id = \(SELECT auth\.uid\(\)\)/i);
    assert.match(check, /has_active_role\( feed_comments\.organization_id/i);
    assert.match(check, /EXISTS \( SELECT 1 FROM public\.feed_posts AS post/i);
    assert.match(check, /post\.id = feed_comments\.post_id/i);
    assert.match(check, /post\.organization_id = feed_comments\.organization_id/i);
  });
});
