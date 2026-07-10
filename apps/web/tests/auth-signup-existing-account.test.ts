import assert from "node:assert";
import { describe, it } from "node:test";

import { isExistingAccountSignup } from "@teammeet/core";

describe("existing-account signup detection", () => {
  // Regression: signUp for an already-confirmed email returns a "success"
  // response with an obfuscated identity-less user and sends NO email, but
  // the signup UI told the person to check their inbox for a confirmation
  // that never arrives.
  it("flags the obfuscated identity-less user Supabase returns for a registered email", () => {
    assert.strictEqual(
      isExistingAccountSignup({
        id: "cff56e97-c184-45d5-8ffc-e193bcfb9b97",
        email: "j.martin1@student.fdu.edu",
        identities: [],
      }),
      true
    );
  });

  it("does not flag a genuinely new signup, which carries its email identity", () => {
    assert.strictEqual(
      isExistingAccountSignup({
        id: "0cfca2c7-368a-4af4-a917-72dbb344ac77",
        email: "new.user@student.fdu.edu",
        identities: [{ provider: "email" }],
      }),
      false
    );
  });

  it("does not flag responses without a user or without an identities array", () => {
    assert.strictEqual(isExistingAccountSignup(null), false);
    assert.strictEqual(isExistingAccountSignup(undefined), false);
    assert.strictEqual(isExistingAccountSignup({ identities: undefined }), false);
    assert.strictEqual(isExistingAccountSignup({ identities: null }), false);
  });
});
