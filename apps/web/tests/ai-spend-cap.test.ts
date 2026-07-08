import test from "node:test";
import assert from "node:assert/strict";
import {
  AiCapReachedError,
  isAiSpendBypassed,
  __test,
  type SpendStatus,
} from "@/lib/ai/spend";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.AI_PRICES_JSON;
}

test("priceCents: Nova default pricing math (micro + lite)", () => {
  resetEnv();
  // defaults: nova-micro in=3.5, out=14 cents per Mtok. The full inference
  // profile id (us.amazon.nova-micro-v1:0) matches the "nova-micro" substring.
  // 1_000_000 in @ 3.5c + 1_000_000 out @ 14c = 17.5c -> rounds to 18.
  assert.equal(__test.priceCents("us.amazon.nova-micro-v1:0", 1_000_000, 1_000_000), 18);
  // nova-lite in=6, out=24 -> 30c. Longest-key match beats a bare "nova".
  assert.equal(__test.priceCents("us.amazon.nova-lite-v1:0", 1_000_000, 1_000_000), 30);
});

test("priceCents: unknown model returns 0 and logs once", () => {
  resetEnv();
  process.env.AI_PRICES_JSON = "{}";
  const origWarn = console.warn;
  let warnCount = 0;
  console.warn = () => { warnCount++; };
  try {
    const a = __test.priceCents("totally-unknown-model-xyz", 1000, 1000);
    const b = __test.priceCents("totally-unknown-model-xyz", 5000, 5000);
    assert.equal(a, 0);
    assert.equal(b, 0);
    assert.equal(warnCount, 1);
  } finally {
    console.warn = origWarn;
  }
});

test("priceCents: AI_PRICES_JSON env beats defaults", () => {
  resetEnv();
  process.env.AI_PRICES_JSON = JSON.stringify({
    "nova-micro": { in: 100, out: 200 },
  });
  // 1_000_000 in @ 100 + 1_000_000 out @ 200 = 300
  const cents = __test.priceCents("us.amazon.nova-micro-v1:0", 1_000_000, 1_000_000);
  assert.equal(cents, 300);
});

test("AiCapReachedError.toResponse: 402 JSON shape", async () => {
  const status: SpendStatus = {
    allowed: false,
    spendCents: 2237,
    capCents: 2200,
    periodEnd: "2026-04-30T23:59:59.999Z",
  };
  const err = new AiCapReachedError(status);
  const res = err.toResponse();
  assert.equal(res.status, 402);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, "ai_monthly_cap_reached");
  assert.equal(body.currentCents, 2237);
  assert.equal(body.capCents, 2200);
  assert.equal(body.periodEnd, "2026-04-30T23:59:59.999Z");
});

test("isAiSpendBypassed: true for DEV_ADMIN_EMAILS, false otherwise", () => {
  resetEnv();
  process.env.DEV_ADMIN_EMAILS = "dev@example.com,owner@team.io";
  assert.equal(isAiSpendBypassed({ email: "dev@example.com" }), true);
  assert.equal(isAiSpendBypassed({ email: "DEV@example.com" }), true);
  assert.equal(isAiSpendBypassed({ email: "owner@team.io" }), true);
  assert.equal(isAiSpendBypassed({ email: "user@example.com" }), false);
  assert.equal(isAiSpendBypassed(null), false);
  assert.equal(isAiSpendBypassed(undefined), false);
  assert.equal(isAiSpendBypassed({ email: null }), false);
});
