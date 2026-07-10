import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getEngagementMetricsModule } from "../src/lib/ai/tools/registry/get-engagement-metrics.ts";
import { verifyToolBackedResponse } from "../src/lib/ai/grounding/tool/verifier.ts";

const ORG_ID = "org-1";
const USER_ID = "user-1";
const FIXED_NOW = "2026-07-09T12:00:00.000Z";

interface CallRecord {
  table: string;
  select: string;
  filters: Record<string, unknown>;
  head: boolean;
}

interface StubOptions {
  failCounts?: Set<string>;
  failAuthors?: Set<string>;
}

const COUNTS: Record<string, number> = {
  events: 4,
  event_rsvps: 31,
  announcements: 6,
  discussion_threads: 5,
  discussion_replies: 18,
  feed_posts: 9,
  feed_comments: 22,
  chat_messages: 44,
};

const AUTHOR_ROWS: Record<string, Array<Record<string, string | null>>> = {
  "announcements.created_by_user_id": [
    { created_by_user_id: "user-a" },
    { created_by_user_id: "user-b" },
  ],
  "discussion_threads.author_id": [{ author_id: "user-c" }],
  "discussion_replies.author_id": [{ author_id: "user-a" }, { author_id: null }],
  "feed_posts.author_id": [{ author_id: "user-d" }],
  "feed_comments.author_id": [{ author_id: "user-b" }],
  "chat_messages.author_id": [{ author_id: "user-e" }],
};

function makeStubSb(options: StubOptions = {}) {
  const calls: CallRecord[] = [];

  function builder(table: string) {
    const record: CallRecord = { table, select: "", filters: {}, head: false };
    const chain = {
      select(cols: string, opts?: { head?: boolean }) {
        record.select = cols;
        record.head = Boolean(opts?.head);
        return chain;
      },
      eq(col: string, val: unknown) {
        record.filters[col] = val;
        return chain;
      },
      is(col: string, val: unknown) {
        record.filters[`${col}__is`] = val;
        return chain;
      },
      gte(col: string, val: unknown) {
        record.filters[`${col}__gte`] = val;
        return chain;
      },
      lte(col: string, val: unknown) {
        record.filters[`${col}__lte`] = val;
        return chain;
      },
      then(
        resolve: (
          value:
            | { count: number | null; error: null | { message: string } }
            | { data: unknown; error: null | { message: string } }
        ) => void
      ) {
        calls.push(record);
        if (record.head) {
          if (options.failCounts?.has(table)) {
            resolve({ count: null, error: { message: "count failed" } });
            return;
          }
          resolve({ count: COUNTS[table] ?? 0, error: null });
          return;
        }

        const key = `${table}.${record.select}`;
        if (options.failAuthors?.has(key)) {
          resolve({ data: null, error: { message: "author query failed" } });
          return;
        }
        resolve({ data: AUTHOR_ROWS[key] ?? [], error: null });
      },
    };
    return chain;
  }

  return {
    sb: {
      from: builder,
    },
    calls,
  };
}

const ctx = {
  orgId: ORG_ID,
  userId: USER_ID,
  serviceSupabase: null as never,
  authorization: { kind: "preverified_admin", source: "ai_org_context" } as const,
};

const logContext = { requestId: "req-1", route: "test" } as never;

async function withFixedNow<T>(fn: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => new Date(FIXED_NOW).getTime();
  try {
    return await fn();
  } finally {
    Date.now = originalNow;
  }
}

async function execute(args: Record<string, unknown>, options?: StubOptions) {
  const stub = makeStubSb(options);
  const parsed = getEngagementMetricsModule.argsSchema.parse(args);
  const result = await withFixedNow(() =>
    getEngagementMetricsModule.execute(parsed as never, {
      ctx: ctx as never,
      sb: stub.sb as never,
      logContext,
    })
  );
  return { result, calls: stub.calls };
}

function countCall(calls: CallRecord[], table: string): CallRecord {
  const call = calls.find((record) => record.table === table && record.head);
  assert.ok(call, `missing count call for ${table}`);
  return call;
}

describe("get_engagement_metrics — executor", () => {
  it("returns correct shape with all fields when all queries succeed", async () => {
    const { result } = await execute({});
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.data, {
      window_days: 30,
      events_held: 4,
      event_rsvps: 31,
      announcements_published: 6,
      discussion_threads_created: 5,
      discussion_replies: 18,
      feed_posts: 9,
      feed_comments: 22,
      chat_messages: 44,
      active_contributors: 5,
    });
  });

  it("uses default window_days=30 when not provided", async () => {
    const { result } = await execute({});
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal((result.data as Record<string, unknown>).window_days, 30);
  });

  it("uses custom window_days when provided and passes correct cutoff to queries", async () => {
    const { result, calls } = await execute({ window_days: 14 });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal((result.data as Record<string, unknown>).window_days, 14);
    const cutoff = new Date(
      new Date(FIXED_NOW).getTime() - 14 * 24 * 60 * 60 * 1000
    ).toISOString();
    assert.equal(countCall(calls, "events").filters.start_date__gte, cutoff);
    assert.equal(countCall(calls, "event_rsvps").filters.created_at__gte, cutoff);
  });

  it("degrades to null for individual fields when a count query fails", async () => {
    const { result } = await execute(
      {},
      { failCounts: new Set(["feed_comments"]) }
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as Record<string, unknown>;
    assert.equal(data.feed_comments, null);
    assert.equal(data.events_held, 4);
  });

  it("verifies org-scoping on all queries", async () => {
    const { calls } = await execute({});
    assert.ok(calls.length > 0);
    for (const call of calls) {
      assert.equal(call.filters.organization_id, ORG_ID, call.table);
    }
  });

  it("verifies window filters on count and author queries", async () => {
    const { calls } = await execute({ window_days: 7 });
    const cutoff = new Date(
      new Date(FIXED_NOW).getTime() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    assert.equal(countCall(calls, "events").filters.start_date__gte, cutoff);
    for (const call of calls.filter((record) => record.table !== "events")) {
      assert.equal(call.filters.created_at__gte, cutoff, call.table);
    }
  });

  it("returns null active_contributors only when all author queries fail", async () => {
    const { result: partialResult } = await execute(
      {},
      {
        failAuthors: new Set([
          "announcements.created_by_user_id",
          "discussion_threads.author_id",
        ]),
      }
    );
    assert.equal(partialResult.kind, "ok");
    if (partialResult.kind !== "ok") return;
    assert.equal((partialResult.data as Record<string, unknown>).active_contributors, 4);

    const { result: allFailedResult } = await execute(
      {},
      {
        failAuthors: new Set([
          "announcements.created_by_user_id",
          "discussion_threads.author_id",
          "discussion_replies.author_id",
          "feed_posts.author_id",
          "feed_comments.author_id",
          "chat_messages.author_id",
        ]),
      }
    );
    assert.equal(allFailedResult.kind, "ok");
    if (allFailedResult.kind !== "ok") return;
    assert.equal((allFailedResult.data as Record<string, unknown>).active_contributors, null);
  });

  it("rejects invalid args", () => {
    assert.throws(() => getEngagementMetricsModule.argsSchema.parse({ window_days: 0 }));
    assert.throws(() => getEngagementMetricsModule.argsSchema.parse({ window_days: 366 }));
    assert.throws(() => getEngagementMetricsModule.argsSchema.parse({ window_days: 1.5 }));
    assert.throws(() =>
      getEngagementMetricsModule.argsSchema.parse({ window_days: 30, extra: 1 })
    );
  });
});

describe("get_engagement_metrics — grounding tolerance", () => {
  it("accepts a matching events claim", () => {
    const result = verifyToolBackedResponse({
      content: "The org held 15 events.",
      toolResults: [{ name: "get_engagement_metrics", data: { events_held: 15 } }],
    });
    assert.equal(result.grounded, true, result.failures.join("; "));
  });

  it("fails a mismatched events claim", () => {
    const result = verifyToolBackedResponse({
      content: "The org held 15 events.",
      toolResults: [{ name: "get_engagement_metrics", data: { events_held: 10 } }],
    });
    assert.equal(result.grounded, false);
    assert.match(result.failures.join("\n"), /events claim 15 did not match 10/i);
  });

  it("accepts analytical prose without specific numbers", () => {
    const result = verifyToolBackedResponse({
      content: "Engagement was strong this month.",
      toolResults: [{ name: "get_engagement_metrics", data: { events_held: 10 } }],
    });
    assert.equal(result.grounded, true, result.failures.join("; "));
  });

  it("fails a mismatched RSVPs claim", () => {
    const result = verifyToolBackedResponse({
      content: "There were 20 RSVPs.",
      toolResults: [{ name: "get_engagement_metrics", data: { event_rsvps: 31 } }],
    });
    assert.equal(result.grounded, false);
    assert.match(result.failures.join("\n"), /rsvps claim 20 did not match 31/i);
  });

  it("accepts a matching active contributors claim", () => {
    const result = verifyToolBackedResponse({
      content: "There were 25 active contributors.",
      toolResults: [
        { name: "get_engagement_metrics", data: { active_contributors: 25 } },
      ],
    });
    assert.equal(result.grounded, true, result.failures.join("; "));
  });
});
