import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  performPasswordLogin,
  requestPasswordReset,
  sendMagicLoginLink,
  startOAuthLogin,
} from "../src/lib/auth/form-flows.ts";
import { forgotPasswordSchema, loginSchema } from "../src/lib/schemas/auth.ts";

describe("sign-in form flows", () => {
  it("rejects malformed emails and blank passwords before submission", () => {
    const invalidEmail = loginSchema.safeParse({
      email: "not-an-email",
      password: "password",
    });
    const blankPassword = loginSchema.safeParse({
      email: "member@example.com",
      password: "",
    });

    assert.equal(invalidEmail.success, false);
    assert.equal(blankPassword.success, false);
  });

  it("submits password credentials with the captcha token", async () => {
    let submitted: unknown;

    const result = await performPasswordLogin({
      email: "member@example.com",
      password: "correct horse battery staple",
      captchaToken: "captcha-token",
      signInWithPassword: async (credentials) => {
        submitted = credentials;
        return { error: null };
      },
    });

    assert.deepEqual(submitted, {
      email: "member@example.com",
      password: "correct horse battery staple",
      options: { captchaToken: "captcha-token" },
    });
    assert.deepEqual(result, { status: "success" });
  });

  it("returns password sign-in errors without reporting success", async () => {
    const result = await performPasswordLogin({
      email: "member@example.com",
      password: "wrong password",
      captchaToken: "captcha-token",
      signInWithPassword: async () => ({
        error: { message: "Invalid login credentials" },
      }),
    });

    assert.deepEqual(result, {
      status: "error",
      message: "Invalid login credentials",
    });
  });

  it("sends magic links back through the login callback and preserves the requested page", async () => {
    let submitted: unknown;

    const result = await sendMagicLoginLink({
      email: "member@example.com",
      captchaToken: "captcha-token",
      siteUrl: "https://www.example.com/",
      redirectTo: "/acme/members?view=directory",
      signInWithOtp: async (credentials) => {
        submitted = credentials;
        return { error: null };
      },
    });

    assert.deepEqual(submitted, {
      email: "member@example.com",
      options: {
        emailRedirectTo:
          "https://www.example.com/auth/callback?redirect=%2Facme%2Fmembers%3Fview%3Ddirectory&mode=login",
        captchaToken: "captcha-token",
      },
    });
    assert.deepEqual(result, { status: "success" });
  });

  it("starts Microsoft OAuth with required scopes and a sanitized callback", async () => {
    let submitted: unknown;

    const result = await startOAuthLogin({
      provider: "azure",
      scopes: "openid profile email",
      siteUrl: "https://www.example.com",
      redirectTo: "//attacker.example/phish",
      signInWithOAuth: async (credentials) => {
        submitted = credentials;
        return { error: null };
      },
    });

    assert.deepEqual(submitted, {
      provider: "azure",
      options: {
        redirectTo: "https://www.example.com/auth/callback?redirect=%2Fapp&mode=login",
        scopes: "openid profile email",
      },
    });
    assert.deepEqual(result, { status: "success" });
  });
});

describe("forgot-password form flow", () => {
  it("rejects malformed emails before requesting a reset", () => {
    const result = forgotPasswordSchema.safeParse({ email: "not-an-email" });

    assert.equal(result.success, false);
  });

  it("requests a reset with the captcha token and requested post-reset page", async () => {
    let submitted: unknown;

    const result = await requestPasswordReset({
      email: "member@example.com",
      captchaToken: "captcha-token",
      siteUrl: "https://www.example.com/",
      redirectTo: "/acme/settings",
      resetPasswordForEmail: async (email, options) => {
        submitted = { email, options };
        return { error: null };
      },
    });

    assert.deepEqual(submitted, {
      email: "member@example.com",
      options: {
        redirectTo:
          "https://www.example.com/auth/confirm?next=%2Fauth%2Freset-password%3Fredirect%3D%252Facme%252Fsettings",
        captchaToken: "captcha-token",
      },
    });
    assert.deepEqual(result, { status: "success" });
  });

  it("returns reset request errors without reporting success", async () => {
    const result = await requestPasswordReset({
      email: "member@example.com",
      captchaToken: "captcha-token",
      siteUrl: "https://www.example.com",
      redirectTo: "/app",
      resetPasswordForEmail: async () => ({
        error: { message: "Unable to send reset email" },
      }),
    });

    assert.deepEqual(result, {
      status: "error",
      message: "Unable to send reset email",
    });
  });
});
