import test from "node:test";
import assert from "node:assert/strict";

import { redactSensitiveUrlParams } from "../src/lib/errors/redact-url";

test("redacts recovery token_hash from telemetry URLs", () => {
  assert.equal(
    redactSensitiveUrlParams(
      "https://www.example.com/auth/reset-password?redirect=%2Fapp&token_hash=abc123"
    ),
    "https://www.example.com/auth/reset-password?redirect=%2Fapp&token_hash=redacted"
  );
});

test("redacts oauth code and implicit-flow hash tokens", () => {
  assert.equal(
    redactSensitiveUrlParams("https://www.example.com/auth/callback?code=secret-code"),
    "https://www.example.com/auth/callback?code=redacted"
  );
  assert.equal(
    redactSensitiveUrlParams("https://www.example.com/#access_token=eyJhbGci&type=bearer"),
    "https://www.example.com/#redacted"
  );
});

test("leaves URLs without sensitive params untouched", () => {
  const url = "https://www.example.com/some-org/calendar?view=month";
  assert.equal(redactSensitiveUrlParams(url), url);
  assert.equal(redactSensitiveUrlParams(""), "");
});
