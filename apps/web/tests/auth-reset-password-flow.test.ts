import test from "node:test";
import assert from "node:assert/strict";

import { submitPasswordReset } from "../src/lib/auth/reset-password-flow";

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    verifyOk: async () => {
      calls.push("verify");
      return { error: null };
    },
    verifyFail: async () => {
      calls.push("verify");
      return { error: { message: "Email link is invalid or has expired" } };
    },
    updateOk: async () => {
      calls.push("update");
      return { error: null };
    },
    updateFail: async () => {
      calls.push("update");
      return { error: { message: "New password should be different from the old password." } };
    },
  };
}

test("verifies the recovery token before updating the password", async () => {
  const r = recorder();

  const outcome = await submitPasswordReset({
    password: "new-password-123",
    tokenHash: "abc123",
    tokenAlreadyConsumed: false,
    verifyRecoveryToken: r.verifyOk,
    updatePassword: r.updateOk,
  });

  assert.deepEqual(r.calls, ["verify", "update"]);
  assert.deepEqual(outcome, { status: "success", tokenConsumed: true });
});

test("skips verification when there is no token (session-based reset)", async () => {
  const r = recorder();

  const outcome = await submitPasswordReset({
    password: "new-password-123",
    tokenHash: null,
    tokenAlreadyConsumed: false,
    verifyRecoveryToken: r.verifyOk,
    updatePassword: r.updateOk,
  });

  assert.deepEqual(r.calls, ["update"]);
  assert.deepEqual(outcome, { status: "success", tokenConsumed: false });
});

test("reports an expired link without attempting the password update", async () => {
  const r = recorder();

  const outcome = await submitPasswordReset({
    password: "new-password-123",
    tokenHash: "consumed-by-scanner",
    tokenAlreadyConsumed: false,
    verifyRecoveryToken: r.verifyFail,
    updatePassword: r.updateOk,
  });

  assert.deepEqual(r.calls, ["verify"]);
  assert.deepEqual(outcome, { status: "expired-link", tokenConsumed: false });
});

test("surfaces the update error but keeps the token marked consumed", async () => {
  const r = recorder();

  const outcome = await submitPasswordReset({
    password: "same-as-before-123",
    tokenHash: "abc123",
    tokenAlreadyConsumed: false,
    verifyRecoveryToken: r.verifyOk,
    updatePassword: r.updateFail,
  });

  assert.deepEqual(r.calls, ["verify", "update"]);
  assert.equal(outcome.status, "error");
  assert.equal(outcome.tokenConsumed, true);
  assert.match(
    outcome.status === "error" ? outcome.message : "",
    /different from the old password/
  );
});

test("retry after a failed update does not re-verify the consumed token", async () => {
  const r = recorder();

  const outcome = await submitPasswordReset({
    password: "brand-new-password-123",
    tokenHash: "abc123",
    tokenAlreadyConsumed: true,
    verifyRecoveryToken: r.verifyFail,
    updatePassword: r.updateOk,
  });

  assert.deepEqual(r.calls, ["update"]);
  assert.deepEqual(outcome, { status: "success", tokenConsumed: true });
});
