import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  resetRateLimitStore,
} from "../src/lib/security/rate-limit.ts";

function buildRequest() {
  return new Request("http://localhost/api/ai/org-1/chat", {
    headers: {
      "x-forwarded-for": "203.0.113.10",
    },
  });
}

beforeEach(() => {
  resetRateLimitStore();
});

test("checkRateLimit enforces the per-org bucket independently of user and IP limits", async () => {
  const request = buildRequest();

  const first = await checkRateLimit(request, {
    orgId: "org-1",
    userId: "user-1",
    limitPerIp: 100,
    limitPerUser: 100,
    limitPerOrg: 2,
    feature: "ai-chat",
  });
  const second = await checkRateLimit(request, {
    orgId: "org-1",
    userId: "user-2",
    limitPerIp: 100,
    limitPerUser: 100,
    limitPerOrg: 2,
    feature: "ai-chat",
  });
  const third = await checkRateLimit(request, {
    orgId: "org-1",
    userId: "user-3",
    limitPerIp: 100,
    limitPerUser: 100,
    limitPerOrg: 2,
    feature: "ai-chat",
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  assert.match(third.reason, /Too many requests/);
});
