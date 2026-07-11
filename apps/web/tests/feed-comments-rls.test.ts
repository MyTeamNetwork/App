/**
 * feed_comments UPDATE policy — moderation + un-delete guarantees
 *
 * 20270109000000_restore_feed_comments_moderation.sql restores two protections
 * that 20270104100000_enforce_feed_parent_organization.sql dropped:
 *   1. Org admins can soft-delete (moderate) another member's comment.
 *   2. Nobody can un-delete: rows with deleted_at set are not updatable.
 * It also keeps the parent-post organization match introduced by 20270104100000.
 *
 * These tests simulate the policy's USING/WITH CHECK boolean logic (repo
 * convention — see parents-rls.test.ts) and pin the migration source so a
 * future policy rewrite that drops either protection fails loudly.
 *
 * Run: node --import ./tests/register-ts-loader.mjs --test tests/feed-comments-rls.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── Policy simulation ──────────────────────────────────────────────────────────

type OrgRole = "admin" | "active_member" | "alumni" | "parent";

interface CommentRow {
  authorId: string;
  organizationId: string;
  postId: string;
  deletedAt: string | null;
}

interface PostRow {
  id: string;
  organizationId: string;
  deletedAt: string | null;
}

interface Actor {
  userId: string;
  activeRoles: Map<string, OrgRole>; // organizationId → role
}

function hasActiveRole(actor: Actor, orgId: string, allowed: OrgRole[]): boolean {
  const role = actor.activeRoles.get(orgId);
  return role !== undefined && allowed.includes(role);
}

/** Mirrors the USING clause: which existing rows the actor may target. */
function policyUsing(actor: Actor, row: CommentRow): boolean {
  return (
    row.deletedAt === null &&
    (row.authorId === actor.userId || hasActiveRole(actor, row.organizationId, ["admin"]))
  );
}

/** Mirrors the WITH CHECK clause: which post-update row states are accepted. */
function policyWithCheck(actor: Actor, updated: CommentRow, posts: PostRow[]): boolean {
  const parentMatches = posts.some(
    (p) => p.id === updated.postId && p.organizationId === updated.organizationId
  );
  if (!parentMatches) return false;
  if (updated.authorId === actor.userId) return true;
  return (
    hasActiveRole(actor, updated.organizationId, ["admin"]) && updated.deletedAt !== null
  );
}

function canUpdate(
  actor: Actor,
  before: CommentRow,
  after: CommentRow,
  posts: PostRow[]
): boolean {
  return policyUsing(actor, before) && policyWithCheck(actor, after, posts);
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const ORG = "org-1";
const OTHER_ORG = "org-2";
const AUTHOR = "user-author";
const ADMIN = "user-admin";
const MEMBER = "user-member";

const livePost: PostRow = { id: "post-1", organizationId: ORG, deletedAt: null };
const deletedPost: PostRow = { id: "post-2", organizationId: ORG, deletedAt: "2027-01-01" };
const posts = [livePost, deletedPost];

const liveComment: CommentRow = {
  authorId: AUTHOR,
  organizationId: ORG,
  postId: livePost.id,
  deletedAt: null,
};

const author: Actor = { userId: AUTHOR, activeRoles: new Map([[ORG, "active_member"]]) };
const admin: Actor = { userId: ADMIN, activeRoles: new Map([[ORG, "admin"]]) };
const member: Actor = { userId: MEMBER, activeRoles: new Map([[ORG, "active_member"]]) };
const otherOrgAdmin: Actor = { userId: ADMIN, activeRoles: new Map([[OTHER_ORG, "admin"]]) };

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("feed_comments_update — author capabilities", () => {
  it("author edits own live comment", () => {
    assert.ok(canUpdate(author, liveComment, liveComment, posts));
  });

  it("author soft-deletes own comment", () => {
    assert.ok(canUpdate(author, liveComment, { ...liveComment, deletedAt: "2027-01-02" }, posts));
  });

  it("author cannot un-delete own comment (deleted rows are not targetable)", () => {
    const deleted = { ...liveComment, deletedAt: "2027-01-02" };
    assert.ok(!canUpdate(author, deleted, { ...deleted, deletedAt: null }, posts));
  });

  it("author cannot re-parent comment into another organization", () => {
    assert.ok(!canUpdate(author, liveComment, { ...liveComment, organizationId: OTHER_ORG }, posts));
  });
});

describe("feed_comments_update — admin moderation", () => {
  it("admin soft-deletes another member's comment (the restored regression case)", () => {
    assert.ok(canUpdate(admin, liveComment, { ...liveComment, deletedAt: "2027-01-02" }, posts));
  });

  it("admin can moderate a comment whose parent post is itself soft-deleted", () => {
    const orphaned = { ...liveComment, postId: deletedPost.id };
    assert.ok(canUpdate(admin, orphaned, { ...orphaned, deletedAt: "2027-01-02" }, posts));
  });

  it("admin cannot edit another member's comment body (soft-delete only)", () => {
    // Body edit = row stays live (deletedAt null) → admin branch of WITH CHECK fails.
    assert.ok(!canUpdate(admin, liveComment, liveComment, posts));
  });

  it("admin cannot un-delete another member's deleted comment", () => {
    const deleted = { ...liveComment, deletedAt: "2027-01-02" };
    assert.ok(!canUpdate(admin, deleted, { ...deleted, deletedAt: null }, posts));
  });

  it("admin of a different org has no access", () => {
    assert.ok(!canUpdate(otherOrgAdmin, liveComment, { ...liveComment, deletedAt: "2027-01-02" }, posts));
  });
});

describe("feed_comments_update — non-author non-admin", () => {
  it("ordinary member cannot touch another member's comment", () => {
    assert.ok(!canUpdate(member, liveComment, { ...liveComment, deletedAt: "2027-01-02" }, posts));
    assert.ok(!canUpdate(member, liveComment, liveComment, posts));
  });
});

// ── Migration source contract ──────────────────────────────────────────────────

describe("restore_feed_comments_moderation migration contract", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20270109000000_restore_feed_comments_moderation.sql",
      import.meta.url
    ),
    "utf8"
  ).replace(/\s+/g, " ");

  it("gates USING on live rows and grants the admin moderation branch", () => {
    const match = migration.match(/FOR UPDATE USING \(([\s\S]*?)\) WITH CHECK/i);
    assert.ok(match, "missing USING clause");
    assert.match(match[1], /deleted_at IS NULL/i);
    assert.match(match[1], /author_id = \(SELECT auth\.uid\(\)\)/i);
    assert.match(match[1], /has_active_role\(feed_comments\.organization_id, array\['admin'\]\)/i);
  });

  it("keeps the parent-post organization match and admin soft-delete-only constraint", () => {
    const match = migration.match(/WITH CHECK \(([\s\S]*?)\);/i);
    assert.ok(match, "missing WITH CHECK clause");
    assert.match(match[1], /post\.id = feed_comments\.post_id/i);
    assert.match(match[1], /post\.organization_id = feed_comments\.organization_id/i);
    assert.match(match[1], /deleted_at IS NOT NULL/i);
    // Moderation must survive parent-post soft-deletion: the WITH CHECK EXISTS
    // must NOT filter on post.deleted_at.
    assert.doesNotMatch(match[1], /post\.deleted_at/i);
  });
});
