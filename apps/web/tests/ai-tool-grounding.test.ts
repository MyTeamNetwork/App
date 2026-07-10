import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { parseCurrencyClaim } from "../src/lib/ai/grounding/primitives.ts";
import { verifyToolBackedResponse } from "../src/lib/ai/grounding/tool/verifier.ts";
import { extractMentorReasonCodes } from "../src/lib/ai/grounding/tool/claim-extraction.ts";
import {
  formatMatchExplanation,
  REASON_CODE_LABEL_PATTERNS,
} from "../src/lib/mentorship/presentation.ts";

function makeSuggestMentorsToolResult(
  suggestions: Array<{
    name: string;
    reasons: Array<{ code: string }>;
  }>
) {
  return {
    name: "suggest_mentors" as const,
    data: {
      state: "resolved",
      mentee: { name: "Sam Student" },
      suggestions: suggestions.map((s) => ({
        mentor: { name: s.name },
        reasons: s.reasons.map((r) => ({ code: r.code, label: r.code, weight: 1 })),
      })),
    },
  };
}

function makeSuggestMenteesToolResult(
  suggestions: Array<{
    name: string;
    reasons: Array<{ code: string }>;
  }>
) {
  return {
    name: "suggest_mentees" as const,
    data: {
      state: "resolved",
      mentor: { name: "Mary Mentor" },
      suggestions: suggestions.map((s) => ({
        mentee: { name: s.name },
        reasons: s.reasons.map((r) => ({ code: r.code, label: r.code, weight: 1 })),
      })),
    },
  };
}

const FRESH_FRESHNESS = { state: "fresh", as_of: "2026-03-24T00:00:00.000Z" } as const;

function makeSuggestConnectionsToolResult(
  suggestions: Array<{
    name: string;
    reasons: Array<{ code: string; label: string; weight: number }>;
  }>
) {
  return {
    name: "suggest_connections" as const,
    data: {
      state: "resolved",
      mode: "sql_fallback",
      source_person: { name: "Alex Source" },
      freshness: FRESH_FRESHNESS,
      suggestions,
    },
  };
}

test("verifyToolBackedResponse accepts grounded org stats summaries", () => {
  const result = verifyToolBackedResponse({
    content:
      "Your organization has:\n- Active Members: 23\n- Alumni: 10\n- Parents: 1\n\nTotal: 34 people across all member types.",
    toolResults: [
      {
        name: "get_org_stats",
        data: { active_members: 23, alumni: 10, parents: 1, upcoming_events: 4, donations: null },
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags unsupported org stats summaries", () => {
  const result = verifyToolBackedResponse({
    content: "Your organization has 99 active members and a total of 120 people.",
    toolResults: [
      {
        name: "get_org_stats",
        data: { active_members: 23, alumni: 10, parents: 1, upcoming_events: 4, donations: null },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /active members claim 99 did not match 23/i);
});

test("verifyToolBackedResponse accepts grounded donation analytics summaries", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (90-day window)",
      "- Successful donations: 8",
      "- Raised: $450",
      "- Average successful donation: $56",
      "- Largest successful donation: $125",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 8,
            successful_amount_cents: 45000,
            average_successful_amount_cents: 5625,
            largest_successful_amount_cents: 12500,
          },
        },
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags unsupported donation analytics summaries", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (90-day window)",
      "- Successful donations: 9",
      "- Raised: $999",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 8,
            successful_amount_cents: 45000,
            average_successful_amount_cents: 5625,
            largest_successful_amount_cents: 12500,
          },
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /successful donations claim 9 did not match 8/i);
  assert.match(result.failures.join("\n"), /raised claim \$999 did not match \$450/i);
});

test("verifyToolBackedResponse flags member names absent from tool rows", () => {
  const result = verifyToolBackedResponse({
    content: "- Jane Smith\n- Ghost Person",
    toolResults: [
      {
        name: "list_members",
        data: [
          { name: "Jane Smith", email: "jane@example.com" },
          { name: "John Doe", email: "john@example.com" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /ghost person/i);
});

test("verifyToolBackedResponse accepts member labels with presentation-only role suffixes", () => {
  const result = verifyToolBackedResponse({
    content: "- Patrick Leonard (Parent)\n- Jane Smith (Admin)",
    toolResults: [
      {
        name: "list_members",
        data: [
          { name: "Patrick Leonard", email: "patrick@example.com" },
          { name: "Jane Smith", email: "jane@example.com" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse accepts member labels decorated with positions or titles from RAG", () => {
  // Regression: list_members rows only carry name/email/role/etc, no position
  // or title. The model legitimately enriches names with parenthetical context
  // pulled from RAG chunks (player position, board title, etc). Grounding
  // should match on the bare name and ignore the trailing parenthetical.
  const result = verifyToolBackedResponse({
    content: [
      "- JT Goodman (Running Back)",
      "- Louis Ciccone (Chairman and CEO)",
      "- Jacob Rios (DLINE)",
    ].join("\n"),
    toolResults: [
      {
        name: "list_members",
        data: [
          { name: "JT Goodman", email: "jt@example.com" },
          { name: "Louis Ciccone", email: "louis@example.com" },
          { name: "Jacob Rios", email: "jacob@example.com" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse still flags fabricated member names even when decorated", () => {
  // Regression guard for the fix above: stripping parentheticals must not
  // accidentally accept fabricated bare names. The bare name still has to
  // exist in tool rows. Includes an asymmetric case (Jane Doe shares the
  // first token "Jane" with real row Jane Smith) to prove the matcher
  // requires the *full* bare name, not just a prefix.
  const result = verifyToolBackedResponse({
    content: ["- Ghost Player (Wide Receiver)", "- Jane Doe (Captain)"].join("\n"),
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "Jane Smith", email: "jane@example.com" }],
      },
    ],
  });

  assert.equal(result.grounded, false);
  const joined = result.failures.join("\n");
  assert.match(joined, /ghost player/i);
  assert.match(joined, /jane doe/i);
});

test("verifyToolBackedResponse ignores list-member field labels", () => {
  const result = verifyToolBackedResponse({
    content: [
      "- Patrick Leonard (Parent): Email: patrick@example.com",
      "- Jane Smith (Admin): Email: jane@example.com",
    ].join("\n"),
    toolResults: [
      {
        name: "list_members",
        data: [
          { name: "Patrick Leonard", email: "patrick@example.com" },
          { name: "Jane Smith", email: "jane@example.com" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse rejects unsupported member count claims when answer is not partial", () => {
  const result = verifyToolBackedResponse({
    content: "You have 35 active members in this organization.",
    toolResults: [
      {
        name: "list_members",
        data: Array.from({ length: 20 }, (_, index) => ({
          name: `Member ${index + 1}`,
          email: `member${index + 1}@example.com`,
        })),
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /member count claim 35 exceeded returned rows 20/i);
});

test("verifyToolBackedResponse accepts bounded partial member phrasing", () => {
  const result = verifyToolBackedResponse({
    content: "Showing the first 20 active members:\n- Member 1\n- Member 2",
    toolResults: [
      {
        name: "list_members",
        data: Array.from({ length: 20 }, (_, index) => ({
          name: `Member ${index + 1}`,
          email: `member${index + 1}@example.com`,
        })),
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags event dates absent from tool rows", () => {
  const result = verifyToolBackedResponse({
    content: 'Upcoming event: "Spring Gala" on 2026-05-01.',
    toolResults: [
      {
        name: "list_events",
        data: [{ title: "Spring Gala", start_date: "2026-04-01T18:00:00.000Z" }],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /2026-05-01/i);
});

test("verifyToolBackedResponse flags announcement titles absent from tool rows", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Recent announcements",
      "- Welcome back - 2026-03-20 - audience: all",
      "- Ghost update - 2026-03-21 - audience: members",
    ].join("\n"),
    toolResults: [
      {
        name: "list_announcements",
        data: [
          {
            title: "Welcome back",
            published_at: "2026-03-20T12:00:00.000Z",
            audience: "all",
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /ghost update/i);
});

test("verifyToolBackedResponse flags unsupported suggest_connections reasons", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Dina Direct - VP Product • Acme",
      "Why: direct mentorship and shared city",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        {
          name: "Dina Direct",
          reasons: [{ code: "shared_city", label: "shared city", weight: 15 }],
        },
      ]),
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /unsupported_mentorship/i);
});

test("verifyToolBackedResponse accepts fixed-template suggest_connections output", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Dina Direct - VP Product • Acme",
      "Why: shared industry, shared company, shared role family",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        {
          name: "Dina Direct",
          reasons: [
            { code: "shared_industry", label: "shared industry", weight: 40 },
            { code: "shared_company", label: "shared company", weight: 30 },
            { code: "shared_role_family", label: "shared role family", weight: 20 },
          ],
        },
      ]),
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse rejects out-of-order suggest_connections output", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Sam Second - Founder",
      "Why: shared city",
      "2. Dina Direct - VP Product • Acme",
      "Why: shared industry",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        {
          name: "Dina Direct",
          reasons: [{ code: "shared_industry", label: "shared industry", weight: 40 }],
        },
        {
          name: "Sam Second",
          reasons: [{ code: "shared_city", label: "shared city", weight: 15 }],
        },
      ]),
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /out of ranked order/i);
});

test("verifyToolBackedResponse does not treat non-location 'both in' phrasing as shared_city", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Dina Direct - VP Product • Acme",
      "Why: shared industry and both in the finance sector",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        {
          name: "Dina Direct",
          reasons: [{ code: "shared_industry", label: "shared industry", weight: 40 }],
        },
      ]),
    ],
  });

  assert.equal(result.grounded, true);
});

test("verifyToolBackedResponse accepts shared graduation year phrasing as graduation proximity", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Dina Direct - VP Product • Acme",
      "Why: shared graduation year",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        {
          name: "Dina Direct",
          reasons: [{ code: "graduation_proximity", label: "graduation proximity", weight: 10 }],
        },
      ]),
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse ignores adjacency wording that is not a scored reason", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Dina Direct - VP Product • Acme",
      "Why: adjacent role family, shared industry",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        {
          name: "Dina Direct",
          reasons: [{ code: "shared_industry", label: "shared industry", weight: 24 }],
        },
      ]),
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse accepts grounded list_discussions output", () => {
  const result = verifyToolBackedResponse({
    content: 'Active discussions:\n- "Best practices for onboarding"\n- "Event planning thread"',
    toolResults: [
      {
        name: "list_discussions",
        data: [
          {
            title: "Best practices for onboarding",
            body: "Let's discuss...",
            reply_count: 5,
            is_pinned: false,
            is_locked: false,
            last_activity_at: "2026-03-20T00:00:00.000Z",
          },
          {
            title: "Event planning thread",
            body: "Planning...",
            reply_count: 12,
            is_pinned: true,
            is_locked: false,
            last_activity_at: "2026-03-18T00:00:00.000Z",
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse accepts partial discussion title quote", () => {
  const result = verifyToolBackedResponse({
    content: '- "My new Thread" has 2 replies',
    toolResults: [
      {
        name: "list_discussions",
        data: [
          {
            title: "My new Thread - Check it out!",
            body: "...",
            reply_count: 2,
            is_pinned: false,
            is_locked: false,
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse accepts generated discussion title heads but rejects suffix fragments", () => {
  const word = fc.constantFrom(
    "Roadmap",
    "Budget",
    "Volunteer",
    "Parent",
    "Mentor",
    "Launch",
    "Donor",
    "Travel",
    "Engineering",
    "Alumni"
  );
  const titlePart = fc.tuple(word, word).map(([first, second]) => `${first} ${second}`);

  fc.assert(
    fc.property(
      fc.tuple(titlePart, titlePart).filter(([head, suffix]) => head !== suffix),
      ([head, suffix]) => {
        const fullTitle = `${head} - ${suffix}`;
        const toolResults = [
          {
            name: "list_discussions" as const,
            data: [
              { title: fullTitle, body: "...", reply_count: 4, is_pinned: false, is_locked: false },
            ],
          },
        ];

        const grounded = verifyToolBackedResponse({
          content: `- "${head}" has 4 replies`,
          toolResults,
        });

        assert.equal(grounded.grounded, true, `${head} should match ${fullTitle}`);

        const suffixOnly = verifyToolBackedResponse({
          content: `- "${suffix}" has 4 replies`,
          toolResults,
        });

        assert.equal(suffixOnly.grounded, false, `${suffix} should not match ${fullTitle}`);

        const suffixProse = verifyToolBackedResponse({
          content: `The discussion "${suffix}" looks active.`,
          toolResults,
        });

        assert.equal(suffixProse.grounded, false, `${suffix} prose should not match ${fullTitle}`);
      }
    ),
    { numRuns: 50 }
  );
});

test("verifyToolBackedResponse keeps repeated discussion title heads ambiguous", () => {
  const result = verifyToolBackedResponse({
    content: '- "Sprint 3" has 2 replies',
    toolResults: [
      {
        name: "list_discussions",
        data: [
          {
            title: "Sprint 3 - Backend",
            body: "...",
            reply_count: 2,
            is_pinned: false,
            is_locked: false,
          },
          {
            title: "Sprint 3 - Frontend",
            body: "...",
            reply_count: 2,
            is_pinned: false,
            is_locked: false,
          },
          {
            title: "Sprint 3 - Design",
            body: "...",
            reply_count: 2,
            is_pinned: false,
            is_locked: false,
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((failure) => /sprint 3/i.test(failure)));
});

test("verifyToolBackedResponse accepts exact discussion titles containing reply-like text", () => {
  const result = verifyToolBackedResponse({
    content: '- "Forum has 5 replies per policy"',
    toolResults: [
      {
        name: "list_discussions",
        data: [
          {
            title: "Forum has 5 replies per policy",
            body: "...",
            reply_count: 1,
            is_pinned: false,
            is_locked: false,
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags fabricated discussion title", () => {
  const result = verifyToolBackedResponse({
    content: '- "Real Thread"\n- "Ghost Thread"',
    toolResults: [
      {
        name: "list_discussions",
        data: [
          { title: "Real Thread", body: "...", reply_count: 3, is_pinned: false, is_locked: false },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /ghost thread/i.test(f)));
});

test("verifyToolBackedResponse flags incorrect discussion reply count", () => {
  const result = verifyToolBackedResponse({
    content: '- "Active Discussion" has 99 replies',
    toolResults: [
      {
        name: "list_discussions",
        data: [
          {
            title: "Active Discussion",
            body: "...",
            reply_count: 5,
            is_pinned: false,
            is_locked: false,
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /reply count claim 99 did not match 5/i.test(f)));
});

test("verifyToolBackedResponse accepts grounded list_job_postings output", () => {
  const result = verifyToolBackedResponse({
    content:
      'Current openings:\n- "Software Engineer" at "Acme Corp"\n- "Product Manager" at "Beta Inc"',
    toolResults: [
      {
        name: "list_job_postings",
        data: [
          {
            title: "Software Engineer",
            company: "Acme Corp",
            location: "San Francisco",
            is_active: true,
          },
          { title: "Product Manager", company: "Beta Inc", location: "Remote", is_active: true },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags fabricated company in job postings", () => {
  const result = verifyToolBackedResponse({
    content: '- "Software Engineer" at "Fake Company"',
    toolResults: [
      {
        name: "list_job_postings",
        data: [
          {
            title: "Software Engineer",
            company: "Acme Corp",
            location: "San Francisco",
            is_active: true,
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /fake company/i.test(f)));
});

test("verifyToolBackedResponse flags inflated job posting count", () => {
  const result = verifyToolBackedResponse({
    content: "There are 15 job openings available.",
    toolResults: [
      {
        name: "list_job_postings",
        data: [{ title: "Engineer", company: "Acme", location: "NYC", is_active: true }],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /job posting count claim 15/i.test(f)));
});

test("parseCurrencyClaim handles commas, decimals, and k suffix", () => {
  const cases = [
    { content: "- Raised: $1,234", label: "raised", expected: 1234 },
    { content: "- Raised: $1.2k", label: "raised", expected: 1200 },
    { content: "- Raised: $1234.56", label: "raised", expected: 1235 },
    { content: "- Raised: $12.345", label: "raised", expected: null },
    { content: "No amount here", label: "raised", expected: null },
  ];
  for (const tc of cases) {
    assert.equal(
      parseCurrencyClaim(tc.content, tc.label),
      tc.expected,
      `parseCurrencyClaim(${JSON.stringify(tc.content)})`
    );
  }
});

test("verifyToolBackedResponse flags hallucinated donation trend rows", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (180-day window)",
      "- Successful donations: 1",
      "- Raised: $100",
      "Trend",
      "- 2026-03 - 1 donations - $100",
      "- 2026-04 - 5 donations - $5000",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 1,
            successful_amount_cents: 10000,
            average_successful_amount_cents: 10000,
            largest_successful_amount_cents: 10000,
          },
          trend: [{ bucket_label: "2026-03", amount_cents: 10000, donation_count: 1 }],
          top_purposes: [],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /trend row 2026-04/i.test(f)));
});

test("verifyToolBackedResponse flags mismatched donation counts in trend rows", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (180-day window)",
      "- Successful donations: 1",
      "- Raised: $100",
      "Trend",
      "- 2026-03 - 99 donations - $100",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 1,
            successful_amount_cents: 10000,
            average_successful_amount_cents: 10000,
            largest_successful_amount_cents: 10000,
          },
          trend: [{ bucket_label: "2026-03", amount_cents: 10000, donation_count: 1 }],
          top_purposes: [],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /trend donation count claim 99 did not match 1/i.test(f)));
});

test("verifyToolBackedResponse flags hallucinated top purposes", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (90-day window)",
      "- Successful donations: 1",
      "- Raised: $100",
      "Top purposes",
      "- Fake Drive - 9 donations - $9000",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 1,
            successful_amount_cents: 10000,
            average_successful_amount_cents: 10000,
            largest_successful_amount_cents: 10000,
          },
          trend: [],
          top_purposes: [{ purpose: "Alumni Campaign", amount_cents: 10000, donation_count: 1 }],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /top purpose fake drive/i.test(f)));
});

test("verifyToolBackedResponse flags mismatched donation counts in top-purpose rows", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (90-day window)",
      "- Successful donations: 1",
      "- Raised: $100",
      "Top purposes",
      "- Alumni Campaign - 99 donations - $100",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 1,
            successful_amount_cents: 10000,
            average_successful_amount_cents: 10000,
            largest_successful_amount_cents: 10000,
          },
          trend: [],
          top_purposes: [{ purpose: "Alumni Campaign", amount_cents: 10000, donation_count: 1 }],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(
    result.failures.some((f) => /top purpose donation count claim 99 did not match 1/i.test(f))
  );
});

test("verifyToolBackedResponse flags freeform donation paraphrase lacking formatter labels", () => {
  const result = verifyToolBackedResponse({
    content: "You received 8 donations totaling $450 across the last quarter.",
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 8,
            successful_amount_cents: 45000,
            average_successful_amount_cents: 5625,
            largest_successful_amount_cents: 12500,
          },
          trend: [],
          top_purposes: [],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /did not reference formatter labels/i.test(f)));
});

test("verifyToolBackedResponse accepts currency k-suffix claim that matches cents", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (90-day window)",
      "- Successful donations: 5",
      "- Raised: $1.2k",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 5,
            successful_amount_cents: 120000,
            average_successful_amount_cents: 24000,
            largest_successful_amount_cents: 50000,
          },
          trend: [],
          top_purposes: [],
        },
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse rejects status mix claims without status_counts", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (90-day window)",
      "- Successful donations: 8",
      "- Raised: $450",
      "- Status mix: 8 succeeded - 1 pending - 0 failed",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 8,
            successful_amount_cents: 45000,
            average_successful_amount_cents: 5625,
            largest_successful_amount_cents: 12500,
          },
          trend: [],
          top_purposes: [],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /status mix claim/i.test(f)));
});

test("verifyToolBackedResponse accepts grounded list_donations output", () => {
  const result = verifyToolBackedResponse({
    content: '- "Alumni Campaign" - $125 - jane@example.com',
    toolResults: [
      {
        name: "list_donations",
        data: [
          {
            donor_name: "Jane Doe",
            donor_email: "jane@example.com",
            amount_dollars: 125,
            purpose: "Alumni Campaign",
            status: "succeeded",
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags hallucinated donor in list_donations", () => {
  const result = verifyToolBackedResponse({
    content: '- "Ghost Donor" gave $125',
    toolResults: [
      {
        name: "list_donations",
        data: [
          {
            donor_name: "Jane Doe",
            donor_email: "jane@example.com",
            amount_dollars: 125,
            purpose: "Alumni Campaign",
            status: "succeeded",
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /ghost donor/i.test(f)));
});

test("verifyToolBackedResponse flags donation amount absent from tool rows", () => {
  const result = verifyToolBackedResponse({
    content: "Recent donation of $9999 from an anonymous supporter.",
    toolResults: [
      {
        name: "list_donations",
        data: [
          {
            donor_name: "Anonymous",
            donor_email: null,
            amount_dollars: 125,
            purpose: "Alumni Campaign",
            status: "succeeded",
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /\$9999/i.test(f)));
});

test("verifyToolBackedResponse flags donor leak when hide_donor_names is enabled", () => {
  const result = verifyToolBackedResponse({
    content: '- "Jane Doe" - $125',
    orgContext: { hideDonorNames: true },
    toolResults: [
      {
        name: "list_donations",
        data: [
          {
            donor_name: "Jane Doe",
            donor_email: "jane@example.com",
            amount_dollars: 125,
            purpose: "Alumni Campaign",
            status: "succeeded",
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /jane doe.*leaked/i.test(f)));
});

/* ── U7: mentorship reason-code label⇄code drift + verifier coverage ───────── */

test("every reason code's rendered explanation round-trips to exactly that code", () => {
  // Table-driven drift guard: for every engine code, extracting reason codes
  // from its own rendered explanation must yield exactly [code]. This is what
  // keeps formatMatchExplanation/REASON_LABELS and the verifier's extractor in
  // lockstep so a correct deterministic answer is never flagged.
  for (const { code } of REASON_CODE_LABEL_PATTERNS) {
    const renderedDefault = formatMatchExplanation({ code });
    assert.deepEqual(
      extractMentorReasonCodes(renderedDefault),
      [code],
      `default label for ${code} ("${renderedDefault}") must extract to [${code}]`
    );

    const renderedWithValue = formatMatchExplanation({ code, value: "Acme" });
    assert.ok(
      extractMentorReasonCodes(renderedWithValue).includes(code),
      `valued label for ${code} ("${renderedWithValue}") must include ${code}`
    );

    // Mentee-direction variants ("wants skills you have", "wants to follow
    // your path", "you're N years ahead") must map back to the same code.
    for (const rendered of [
      formatMatchExplanation({ code }, "mentee"),
      formatMatchExplanation({ code, value: "Acme" }, "mentee"),
      formatMatchExplanation({ code, value: 14 }, "mentee"),
    ]) {
      assert.ok(
        extractMentorReasonCodes(rendered).includes(code),
        `mentee-direction label for ${code} ("${rendered}") must include ${code}`
      );
    }
  }
});

test("'Worked at the same company' maps to past_employer_overlap, not shared_company", () => {
  const codes = extractMentorReasonCodes("Why: Worked at the same company");
  assert.deepEqual(codes, ["past_employer_overlap"]);
  assert.ok(!codes.includes("shared_company"));
});

test("'Both worked at Acme' maps to past_employer_overlap only", () => {
  const codes = extractMentorReasonCodes("Both worked at Acme");
  assert.deepEqual(codes, ["past_employer_overlap"]);
});

test("'Same company: Acme' still maps to shared_company (true positive kept)", () => {
  assert.deepEqual(extractMentorReasonCodes("Same company: Acme"), ["shared_company"]);
});

test("suggest_mentors deterministic past-employer reason is no longer flagged", () => {
  const result = verifyToolBackedResponse({
    content: "Top mentors for Sam Student:\n- Mary Mentor\n  Why: Worked at the same company",
    toolResults: [
      makeSuggestMentorsToolResult([
        { name: "Mary Mentor", reasons: [{ code: "past_employer_overlap" }] },
      ]),
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("suggest_mentors flags a 'same company' claim the tool never returned", () => {
  const result = verifyToolBackedResponse({
    content: "- Mary Mentor\n  Why: Same company: Acme",
    toolResults: [
      makeSuggestMentorsToolResult([
        { name: "Mary Mentor", reasons: [{ code: "past_employer_overlap" }] },
      ]),
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /shared_company/.test(f)));
});

test("verifier dispatches suggest_mentees and accepts grounded output", () => {
  const result = verifyToolBackedResponse({
    content: "Top mentees for Mary Mentor:\n- Sam Student\n  Why: Shared topics",
    toolResults: [
      makeSuggestMenteesToolResult([{ name: "Sam Student", reasons: [{ code: "shared_topics" }] }]),
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("suggest_mentees flags an invented mentee name not in tool rows", () => {
  const result = verifyToolBackedResponse({
    content: "- Sam Student\n- Invented Person",
    toolResults: [
      makeSuggestMenteesToolResult([{ name: "Sam Student", reasons: [{ code: "shared_topics" }] }]),
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /invented person.*not present/i.test(f)));
});

test("suggest_mentees flags an unsupported reason code", () => {
  const result = verifyToolBackedResponse({
    content: "- Sam Student\n  Why: Same company: Acme",
    toolResults: [
      makeSuggestMenteesToolResult([{ name: "Sam Student", reasons: [{ code: "shared_topics" }] }]),
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(
    result.failures.some((f) => /suggest_mentees.*unsupported reason shared_company/.test(f))
  );
});

/* ── projection tolerance: verifiers must not false-flag projected-away fields ─ */

test("verifyListMembers does not flag an email when email was projected away", () => {
  // Model called list_members with fields:['name','summary'] — no email key.
  const result = verifyToolBackedResponse({
    content: "Reach out to ada@example.com about the finance mentorship.",
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "Ada Lovelace", summary: "Finance leader" }],
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});

test("verifyListMembers still flags a bogus email when email field IS present", () => {
  const result = verifyToolBackedResponse({
    content: "Email ghost@example.com to connect.",
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "Ada Lovelace", email: "ada@example.com" }],
      },
    ],
  });
  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /ghost@example\.com.*not present/i.test(f)));
});

test("verifyListEvents does not flag a title when title was projected away", () => {
  // Model called list_events with fields:['start_date','location'] — no title.
  const result = verifyToolBackedResponse({
    content: 'The "Alumni Gala" is on the calendar.',
    toolResults: [
      {
        name: "list_events",
        data: [{ start_date: "2026-07-01T12:00:00.000Z", location: "Hall" }],
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});

test("verifyListEvents still flags a bogus title when title field IS present", () => {
  const result = verifyToolBackedResponse({
    content: 'The "Phantom Event" is scheduled.',
    toolResults: [
      {
        name: "list_events",
        data: [{ title: "Alumni Gala", start_date: "2026-07-01T12:00:00.000Z" }],
      },
    ],
  });
  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /phantom event.*not present/i.test(f)));
});

test("verifyToolBackedResponse: multi-tool events+announcements does not false-flag event dates in announcement context", () => {
  const result = verifyToolBackedResponse({
    content: [
      "## Upcoming Events",
      "- Holiday Party on December 15, 2025",
      "- New Year Kickoff on January 15, 2026",
      "",
      "## Recent Announcements",
      "- Year-End Update",
      "- Welcome 2026",
    ].join("\n"),
    toolResults: [
      {
        name: "list_events" as const,
        data: [
          { title: "Holiday Party", start_date: "2025-12-15T18:00:00.000Z" },
          { title: "New Year Kickoff", start_date: "2026-01-15T18:00:00.000Z" },
        ],
      },
      {
        name: "list_announcements" as const,
        data: [
          { title: "Year-End Update", published_at: "2025-12-01T12:00:00.000Z" },
          { title: "Welcome 2026", published_at: "2026-01-01T12:00:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true, result.failures.join("; "));
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse: multi-tool events+announcements still flags a date in neither tool", () => {
  const result = verifyToolBackedResponse({
    content: [
      "## Upcoming Events",
      "- Holiday Party on December 15, 2025",
      "",
      "## Recent Announcements",
      "- Year-End Update",
      "- Fabricated event on March 99, 2025",
    ].join("\n"),
    toolResults: [
      {
        name: "list_events" as const,
        data: [{ title: "Holiday Party", start_date: "2025-12-15T18:00:00.000Z" }],
      },
      {
        name: "list_announcements" as const,
        data: [{ title: "Year-End Update", published_at: "2025-12-01T12:00:00.000Z" }],
      },
    ],
  });

  assert.equal(result.grounded, false);

  // "march 99, 2025" is not a valid date so extractMentionedDates won't extract it.
  // Use a valid-format but foreign ISO date instead.
  // Re-run with a valid date that isn't in either tool.
  const result2 = verifyToolBackedResponse({
    content: [
      "## Upcoming Events",
      "- Holiday Party on December 15, 2025",
      "",
      "## Recent Announcements",
      "- Year-End Update",
      "- Some event happened on 2025-06-01",
    ].join("\n"),
    toolResults: [
      {
        name: "list_events" as const,
        data: [{ title: "Holiday Party", start_date: "2025-12-15T18:00:00.000Z" }],
      },
      {
        name: "list_announcements" as const,
        data: [{ title: "Year-End Update", published_at: "2025-12-01T12:00:00.000Z" }],
      },
    ],
  });

  assert.equal(result2.grounded, false);
  assert.ok(
    result2.failures.some((f) => /2025-06-01/.test(f)),
    result2.failures.join("; ")
  );
});

test("verifyToolBackedResponse: single-tool list_announcements with foreign date still fails", () => {
  const result = verifyToolBackedResponse({
    content: ["## Announcements", "- Year-End Update", "- Something happened on 2025-06-01"].join(
      "\n"
    ),
    toolResults: [
      {
        name: "list_announcements" as const,
        data: [{ title: "Year-End Update", published_at: "2025-12-01T12:00:00.000Z" }],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(
    result.failures.some((f) => /2025-06-01/.test(f)),
    result.failures.join("; ")
  );
});

test("parseStatClaim: year-prefixed context line 'In 2026, active members: 50' is grounded", () => {
  // Tests that a year at line start does not shadow the real stat that follows.
  const result = verifyToolBackedResponse({
    content: "In 2026, active members: 50",
    toolResults: [
      {
        name: "get_org_stats",
        data: { active_members: 50, alumni: 5, parents: 2, upcoming_events: 1, donations: null },
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});

test("parseStatClaim: ISO-date-prefixed context 'As of 2026-07-09, active members: 50' is grounded", () => {
  // Tests that ISO date fragments (07, 09) inside 2026-07-09 cannot be captured
  // as the stat value instead of the real 50.
  const result = verifyToolBackedResponse({
    content: "As of 2026-07-09, active members: 50",
    toolResults: [
      {
        name: "get_org_stats",
        data: { active_members: 50, alumni: 5, parents: 2, upcoming_events: 1, donations: null },
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});

test("parseStatClaim guard: wrong value after year prefix still fails", () => {
  const result = verifyToolBackedResponse({
    content: "In 2026, active members: 99",
    toolResults: [
      {
        name: "get_org_stats",
        data: { active_members: 50, alumni: 5, parents: 2, upcoming_events: 1, donations: null },
      },
    ],
  });
  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /active members claim 99 did not match 50/i.test(f)));
});

test("parseStatClaim guard: plain wrong value still fails", () => {
  const result = verifyToolBackedResponse({
    content: "99 active members",
    toolResults: [
      {
        name: "get_org_stats",
        data: { active_members: 23, alumni: 5, parents: 2, upcoming_events: 1, donations: null },
      },
    ],
  });
  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /active members claim 99 did not match 23/i.test(f)));
});

test("formatKnownEventDates fix C: offset-shifted event 'July 10, 2026' is grounded against '2026-07-10T19:00:00-05:00'", () => {
  // The event start_date is July 10 in local time (UTC-5) but July 11 UTC.
  // The model correctly writes "July 10, 2026" — this must not be rejected.
  const result = verifyToolBackedResponse({
    content: 'Upcoming event: "Team Meeting" on July 10, 2026.',
    toolResults: [
      {
        name: "list_events",
        data: [{ title: "Team Meeting", start_date: "2026-07-10T19:00:00-05:00" }],
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});

test("formatKnownEventDates fix C: zero-padded day 'July 09, 2026' is grounded against '2026-07-09T12:00:00Z'", () => {
  const result = verifyToolBackedResponse({
    content: 'Upcoming event: "Board Meeting" on July 09, 2026.',
    toolResults: [
      {
        name: "list_events",
        data: [{ title: "Board Meeting", start_date: "2026-07-09T12:00:00Z" }],
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});

test("formatKnownEventDates fix C guard: wrong month still fails", () => {
  const result = verifyToolBackedResponse({
    content: 'Upcoming event: "Team Meeting" on July 12, 2026.',
    toolResults: [
      {
        name: "list_events",
        data: [{ title: "Team Meeting", start_date: "2026-07-10T19:00:00-05:00" }],
      },
    ],
  });
  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /july 12, 2026/i.test(f)));
});

test("verifyListMembers fix A: 'John from Finance' matches known name 'John'", () => {
  const result = verifyToolBackedResponse({
    content: "- John from Finance",
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "John" }],
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});

test("verifyListMembers fix A: 'Jane' matches known name 'Jane Smith'", () => {
  const result = verifyToolBackedResponse({
    content: "- Jane",
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "Jane Smith" }],
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});

test("verifyListMembers fix A guard: 'Jane Doe' does not match 'Jane Smith'", () => {
  const result = verifyToolBackedResponse({
    content: "- Jane Doe",
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "Jane Smith" }],
      },
    ],
  });
  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /jane doe/i.test(f)));
});

test("verifyListMembers fix A guard: 'Totally Unknown Person' still fails", () => {
  const result = verifyToolBackedResponse({
    content: "- Totally Unknown Person",
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "Jane Smith" }],
      },
    ],
  });
  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /totally unknown person/i.test(f)));
});

test("verifyListDiscussions fix B: unquoted ambiguous head 'Sprint 3 - planning notes' is grounded", () => {
  // Unquoted list entry whose head "Sprint 3" prefixes multiple real titles.
  // This is not fabrication — matching multiple real titles should be accepted.
  const result = verifyToolBackedResponse({
    content: "- Sprint 3 - planning notes",
    toolResults: [
      {
        name: "list_discussions",
        data: [
          {
            title: "Sprint 3 - Backend",
            body: "...",
            reply_count: 3,
            is_pinned: false,
            is_locked: false,
          },
          {
            title: "Sprint 3 - Frontend",
            body: "...",
            reply_count: 2,
            is_pinned: false,
            is_locked: false,
          },
        ],
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});

test("verifyListDiscussions fix B guard: unquoted fabricated discussion title still fails", () => {
  const result = verifyToolBackedResponse({
    content: "- Ghost Thread",
    toolResults: [
      {
        name: "list_discussions",
        data: [
          {
            title: "Sprint 3 - Backend",
            body: "...",
            reply_count: 3,
            is_pinned: false,
            is_locked: false,
          },
          {
            title: "Sprint 3 - Frontend",
            body: "...",
            reply_count: 2,
            is_pinned: false,
            is_locked: false,
          },
        ],
      },
    ],
  });
  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /ghost thread/i.test(f)));
});

/* ── U8: single-word known-name containment guard (hallucination hole fix) ─── */

test("verifyListMembers guard: 'Sam Carter' is NOT grounded by single-word known name 'Sam'", () => {
  // This was the hallucination hole: " sam " is contained in " sam carter "
  // so the old predicate wrongly accepted it. After the fix, single-word known
  // names only ground a candidate when the next word is a prose connector.
  const result = verifyToolBackedResponse({
    content: "- Sam Carter",
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "Sam" }],
      },
    ],
  });
  assert.equal(result.grounded, false);
  assert.ok(
    result.failures.some((f) => /sam carter.*not present/i.test(f)),
    `expected failure about "sam carter", got: ${result.failures.join("; ")}`
  );
});

test("verifyListMembers guard: 'John from Finance' still grounded by single-word known name 'John' (regression)", () => {
  // Prose-continuation case must remain green: "from" is in the connector allowlist.
  const result = verifyToolBackedResponse({
    content: "- John from Finance",
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "John" }],
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});

test("verifyListMembers guard: 'Alice in Wonderland' grounded by single-word known name 'Alice' (connector: in)", () => {
  // "in" is in the connector allowlist.
  const result = verifyToolBackedResponse({
    content: "- Alice in Wonderland",
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "Alice" }],
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});

test("verifyListMembers guard: 'John Carter' NOT grounded by single-word known name 'John'", () => {
  // "carter" is not a connector -- this is a fabricated last name.
  const result = verifyToolBackedResponse({
    content: "- John Carter",
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "John" }],
      },
    ],
  });
  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /john carter/i.test(f)));
});

test("verifyListMembers guard: 'John Smith Jr' grounded by multi-word known name 'John Smith'", () => {
  // Multi-word known name CAN ground a longer candidate -- the original
  // legitimate case. " john smith " is contained in " john smith jr ".
  const result = verifyToolBackedResponse({
    content: "- John Smith Jr",
    toolResults: [
      {
        name: "list_members",
        data: [{ name: "John Smith" }],
      },
    ],
  });
  assert.equal(result.grounded, true, result.failures.join("; "));
});
