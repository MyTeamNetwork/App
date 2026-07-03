import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  captureSanitized,
  runWithoutCapture,
  sanitizeError,
  setCaptureTransportForTesting,
} from "@/lib/errors/sanitize";
import type { CaptureErrorParams } from "@/lib/errors/server";
import { databaseError, internalError, createResponder } from "@/lib/api/response";
import { aiLog } from "@/lib/ai/logger";

/**
 * U7 — error capture at server chokepoints, with a sanitization boundary.
 *
 * The node:test runner has no module mocking, so these tests use the explicit
 * transport seam (`setCaptureTransportForTesting`) instead of stubbing the
 * Supabase service client.
 */

function installRecorder(): CaptureErrorParams[] {
  const captured: CaptureErrorParams[] = [];
  setCaptureTransportForTesting(async (params) => {
    captured.push(params);
  });
  return captured;
}

function silenceConsoleError() {
  return mock.method(console, "error", () => {});
}

afterEach(() => {
  setCaptureTransportForTesting(null);
  mock.restoreAll();
});

// ── Sanitization boundary ───────────────────────────────────────────────────

describe("sanitizeError", () => {
  it("bounds a long newline-heavy payload message to a single ~500-char line", () => {
    const payload = Array.from({ length: 200 }, (_, i) => `{"row":${i},"body":"secret payload line"}`).join("\n");
    const params = sanitizeError(new Error(`upstream rejected:\n${payload}`));

    assert.ok(params.message.length <= 500, `message too long: ${params.message.length}`);
    assert.ok(!params.message.includes("\n"), "newlines must be collapsed");
    assert.ok(params.message.startsWith("upstream rejected:"));
    assert.ok(params.message.endsWith("…"), "truncation must be visible");
  });

  it("keeps short messages intact and preserves name + stack", () => {
    const err = new TypeError("boom");
    const params = sanitizeError(err);

    assert.equal(params.name, "TypeError");
    assert.equal(params.message, "boom");
    assert.equal(params.stack, err.stack);
  });

  it("enforces the meta allowlist — raw extra objects and unknown keys never pass", () => {
    const params = sanitizeError(new Error("boom"), {
      context: {
        requestId: "req-1",
        orgId: "org-1",
        threadId: "thread-1",
        userId: "user-1",
        module: "rag",
        // Everything below must be dropped:
        password: "hunter2",
        promptPayload: { messages: ["private RAG chunk"] },
        headers: { authorization: "Bearer xyz" },
        error: new Error("raw caught error"),
      },
    });

    assert.deepEqual(params.meta, {
      requestId: "req-1",
      orgId: "org-1",
      threadId: "thread-1",
      userId: "user-1",
      module: "rag",
      errorName: "Error",
    });
    assert.equal(params.userId, "user-1");
  });

  it("drops allowlisted keys whose values are not safe scalars", () => {
    const params = sanitizeError(new Error("boom"), {
      context: {
        requestId: { nested: "object" },
        orgId: ["array"],
        module: "ok-module",
      },
    });

    assert.deepEqual(params.meta, { module: "ok-module", errorName: "Error" });
  });

  it("bounds oversized meta string values", () => {
    const params = sanitizeError(new Error("boom"), {
      context: { requestId: "x".repeat(1000) },
    });

    assert.equal((params.meta?.requestId as string).length, 200);
  });

  it("extracts message-bearing non-Error objects (e.g. PostgrestError shape)", () => {
    const params = sanitizeError(
      { message: "relation does not exist", code: "42P01" },
      { fallbackName: "AiModuleError" }
    );

    assert.equal(params.name, "AiModuleError");
    assert.equal(params.message, "relation does not exist");
  });
});

// ── Response helper chokepoints ─────────────────────────────────────────────

describe("internalError / databaseError capture", () => {
  it("internalError(message, err) triggers exactly one bounded capture and the response is unchanged", async () => {
    const captured = installRecorder();

    const withError = internalError("Something failed.", new Error(`db exploded\n${"x".repeat(2000)}`), {
      requestId: "req-42",
      userId: "user-42",
    });
    const withoutError = internalError("Something failed.");

    assert.equal(captured.length, 1);
    assert.equal(captured[0].name, "Error");
    assert.ok(captured[0].message.length <= 500);
    assert.ok(!captured[0].message.includes("\n"));
    assert.equal(captured[0].severity, "high");
    assert.equal(captured[0].meta?.requestId, "req-42");
    assert.equal(captured[0].meta?.module, "api-response:internal_error");
    assert.equal(captured[0].userId, "user-42");

    // Response shape is identical with or without the error param.
    assert.equal(withError.status, 500);
    assert.deepEqual(await withError.json(), await withoutError.json());
  });

  it("internalError() without an error captures nothing (backward compatible)", () => {
    const captured = installRecorder();
    const res = internalError();

    assert.equal(captured.length, 0);
    assert.equal(res.status, 500);
  });

  it("databaseError(message, err) captures with the database module tag", () => {
    const captured = installRecorder();
    const res = databaseError("A database error occurred.", new Error("connection refused"));

    assert.equal(captured.length, 1);
    assert.equal(captured[0].meta?.module, "api-response:database_error");
    assert.equal(res.status, 500);
  });

  it("createResponder().internalError(message, err) captures and keeps headers", async () => {
    const captured = installRecorder();
    const responder = createResponder({ "X-RateLimit-Limit": "10" });
    const res = responder.internalError("boom", new Error("underlying"));

    assert.equal(captured.length, 1);
    assert.equal(res.status, 500);
    assert.equal(res.headers.get("X-RateLimit-Limit"), "10");
  });

  it("a capture transport that throws synchronously does not change the response", async () => {
    silenceConsoleError();
    setCaptureTransportForTesting(() => {
      throw new Error("capture pipeline down");
    });

    const res = internalError("Something failed.", new Error("original"));

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.message, "Something failed.");
    assert.equal(body.code, "INTERNAL_ERROR");
  });

  it("a capture transport that rejects does not change the response or leak an unhandled rejection", async () => {
    silenceConsoleError();
    setCaptureTransportForTesting(() => Promise.reject(new Error("db down")));

    const res = internalError("Something failed.", new Error("original"));
    assert.equal(res.status, 500);

    // Let the rejected promise settle through the internal .catch.
    await new Promise((resolve) => setImmediate(resolve));
  });
});

// ── aiLog chokepoint ────────────────────────────────────────────────────────

describe("aiLog error forwarding", () => {
  const ctx = { requestId: "req-9", orgId: "org-9", threadId: "thread-9", userId: "user-9" };

  it('aiLog("error") forwards structured ctx + module + message into capture', () => {
    silenceConsoleError();
    const captured = installRecorder();

    aiLog("error", "rag-retriever", "retrieval failed", ctx, { error: new Error("timeout after 30s") });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].message, "retrieval failed: timeout after 30s");
    assert.deepEqual(captured[0].meta, {
      requestId: "req-9",
      orgId: "org-9",
      threadId: "thread-9",
      userId: "user-9",
      module: "rag-retriever",
      errorName: "Error",
    });
  });

  it("raw aiLog extra never reaches meta", () => {
    silenceConsoleError();
    const captured = installRecorder();

    aiLog("error", "context-builder", "context assembly failed", ctx, {
      prompt: "private prompt content",
      ragChunks: ["chunk a", "chunk b"],
      tokens: 1234,
    });

    assert.equal(captured.length, 1);
    const metaKeys = Object.keys(captured[0].meta ?? {});
    assert.ok(!metaKeys.includes("prompt"));
    assert.ok(!metaKeys.includes("ragChunks"));
    assert.ok(!metaKeys.includes("tokens"));
    assert.equal(captured[0].message, "context assembly failed");
  });

  it('aiLog("warn") and aiLog("info") never capture', () => {
    const captured = installRecorder();
    const warnMock = mock.method(console, "warn", () => {});
    const logMock = mock.method(console, "log", () => {});

    aiLog("warn", "rag", "slow retrieval", ctx);
    aiLog("info", "rag", "retrieval ok", ctx);

    assert.equal(captured.length, 0);
    assert.equal(warnMock.mock.callCount(), 1);
    assert.equal(logMock.mock.callCount(), 1);
  });

  it("console logging behavior is unchanged when capture is wired", () => {
    const captured = installRecorder();
    const errMock = mock.method(console, "error", () => {});

    aiLog("error", "chat", "stream failed", ctx, { error: new Error("boom") });

    assert.equal(errMock.mock.callCount(), 1);
    const [label, payload] = errMock.mock.calls[0].arguments as [string, Record<string, unknown>];
    assert.equal(label, "[chat] stream failed");
    assert.equal(payload.requestId, "req-9");
    assert.equal(captured.length, 1);
  });
});

// ── Recursion guards ────────────────────────────────────────────────────────

describe("recursion guards", () => {
  it("a transport that synchronously re-enters captureSanitized does not recurse", () => {
    silenceConsoleError();
    let calls = 0;
    setCaptureTransportForTesting(async () => {
      calls += 1;
      // Simulate a failure inside the capture path that itself tries to capture.
      captureSanitized(new Error("failure inside capture path"));
    });

    captureSanitized(new Error("outer"));

    assert.equal(calls, 1, "re-entrant capture must be suppressed");
  });

  it("runWithoutCapture suppresses all capture inside the scope (ingest-route guard)", async () => {
    silenceConsoleError();
    const captured = installRecorder();

    await runWithoutCapture(async () => {
      captureSanitized(new Error("sync inside scope"));
      await Promise.resolve();
      captureSanitized(new Error("async inside scope"));
      internalError("boom", new Error("via response helper inside scope"));
    });

    assert.equal(captured.length, 0);

    // Outside the scope, capture works again.
    captureSanitized(new Error("outside scope"));
    assert.equal(captured.length, 1);
  });
});
