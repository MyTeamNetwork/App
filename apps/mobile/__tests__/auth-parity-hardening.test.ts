import { readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(process.cwd(), "app/(auth)");
const forgotPasswordSource = readFileSync(join(appRoot, "forgot-password.tsx"), "utf8");
const signupSource = readFileSync(join(appRoot, "signup.tsx"), "utf8");
const signupLayoutSource = readFileSync(join(appRoot, "_layout.tsx"), "utf8");
const rootLayoutSource = readFileSync(join(process.cwd(), "app/_layout.tsx"), "utf8");
const validationSource = readFileSync(
  join(process.cwd(), "../../packages/validation/src/schemas.ts"),
  "utf8",
);

describe("mobile auth parity hardening", () => {
  it.each([
    ["forgot-password", forgotPasswordSource],
    ["signup", signupSource],
  ])("bounds %s Turnstile loading and cleans up on unmount", (_screen, source) => {
    expect(source).toContain("const CAPTCHA_LOAD_TIMEOUT_MS = 15_000");
    expect(source).toContain('handleCaptchaError("captcha load timeout")');
    expect(source).toContain("clearCaptchaTimeout();");
    expect(source).toMatch(/useEffect\(\(\) => \{\s*return \(\) => \{\s*clearCaptchaTimeout\(\);/s);
  });

  it("uses one shared twelve-character password policy", () => {
    expect(validationSource).toContain("export const PASSWORD_MIN_LENGTH = 12");
    expect(signupSource).toContain("PASSWORD_MIN_LENGTH");
    expect(signupSource).toContain("PASSWORD_REQUIREMENTS");
  });

  it("keeps password recovery on the web-owned flow", () => {
    expect(signupLayoutSource).not.toContain('name="reset-password"');
    expect(rootLayoutSource).not.toContain("isOnResetPassword");
  });
});
