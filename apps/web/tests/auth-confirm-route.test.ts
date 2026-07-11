import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.example.com";

const { createRecoveryConfirmHandler } = await import("../src/lib/auth/recovery-confirm-handler.ts");

test("confirm route forwards the recovery token to reset-password without consuming it", async () => {
  const handler = createRecoveryConfirmHandler();

  const request = new NextRequest(
    "https://www.example.com/auth/confirm?token_hash=abc123&type=recovery&next=%2Fauth%2Freset-password%3Fredirect%3D%252Fdashboard"
  );

  const response = await handler(request);

  assert.equal(
    response.headers.get("location"),
    "https://www.example.com/auth/reset-password?redirect=%2Fdashboard&token_hash=abc123"
  );
  // The token must NOT be exchanged on GET — no session cookies may be set here.
  assert.equal(response.headers.get("set-cookie"), null);
});

test("confirm route rejects invalid next paths and falls back to reset-password", async () => {
  const handler = createRecoveryConfirmHandler();

  const request = new NextRequest(
    "https://www.example.com/auth/confirm?token_hash=abc123&type=recovery&next=%2Fauth%2Flogin"
  );

  const response = await handler(request);

  assert.equal(
    response.headers.get("location"),
    "https://www.example.com/auth/reset-password?token_hash=abc123"
  );
});

test("confirm route redirects to auth error when token_hash is missing", async () => {
  const handler = createRecoveryConfirmHandler();

  const request = new NextRequest("https://www.example.com/auth/confirm?type=recovery");

  const response = await handler(request);
  const location = response.headers.get("location");

  assert.ok(location);
  const redirectUrl = new URL(location);
  assert.equal(redirectUrl.pathname, "/auth/error");
  assert.match(redirectUrl.searchParams.get("message") ?? "", /invalid or has expired/);
});

test("confirm route only accepts type=recovery", async () => {
  const handler = createRecoveryConfirmHandler();

  for (const type of ["magiclink", "signup", "invite", "email_change", "phone_change", ""]) {
    const request = new NextRequest(
      `https://www.example.com/auth/confirm?token_hash=abc123&type=${type}`
    );

    const response = await handler(request);
    const location = response.headers.get("location");

    assert.ok(location, `type=${type} must redirect`);
    assert.equal(new URL(location).pathname, "/auth/error", `type=${type} must be rejected`);
  }
});

test("confirm route redirects to auth error for malformed token_hash", async () => {
  const handler = createRecoveryConfirmHandler();

  const request = new NextRequest(
    "https://www.example.com/auth/confirm?token_hash=abc%2F%3C123%3E&type=recovery"
  );

  const response = await handler(request);
  const location = response.headers.get("location");

  assert.ok(location);
  assert.equal(new URL(location).pathname, "/auth/error");
});
