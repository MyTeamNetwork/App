import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("email OTP configuration matches the 8-digit claim and login clients", () => {
  const config = readFileSync(path.join(repoRoot, "supabase/config.toml"), "utf8");
  const emailSection = config.match(/\[auth\.email\]\n([\s\S]*?)(?=\n\[|$)/)?.[1];

  assert.ok(emailSection, "auth.email configuration is missing");
  assert.match(emailSection, /\botp_length\s*=\s*8\b/);
});

test("magic-link email is code-only so link scanners cannot consume the OTP", () => {
  const config = readFileSync(path.join(repoRoot, "supabase/config.toml"), "utf8");
  const template = readFileSync(
    path.join(repoRoot, "supabase/templates/magic_link.html"),
    "utf8",
  );

  assert.match(config, /\[auth\.email\.template\.magic_link\]/);
  assert.match(template, /{{\s*\.Token\s*}}/);
  assert.doesNotMatch(template, /ConfirmationURL|TokenHash|RedirectTo/);
  assert.doesNotMatch(template, /<a\b/i);
});
