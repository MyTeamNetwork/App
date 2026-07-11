import { test as setup, expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { TestData } from "./fixtures/test-data";

const authFile = "playwright/.auth/e2e-state.json";

/**
 * Authenticate as the E2E admin via Supabase admin-issued magic link.
 *
 * Password login is blocked by hCaptcha on the Supabase project, so we mint
 * a one-shot magiclink token with the service role key. /auth/confirm only
 * handles recovery links (and no longer verifies on GET — see
 * recovery-confirm-handler), so the token is exchanged directly against
 * GoTrue here and the resulting session cookies are injected into the
 * browser context. This requires:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - E2E_ADMIN_EMAIL
 *   - E2E_ORG_SLUG (read via TestData.getOrgSlug())
 */
setup("authenticate as E2E admin", async ({ page, baseURL }) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { email } = TestData.getAdminCredentials();
  const orgSlug = TestData.getOrgSlug();

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  if (!baseURL) throw new Error("Missing Playwright baseURL");

  const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`generate_link failed: ${res.status} ${body}`);
  }

  const payload = (await res.json()) as {
    hashed_token?: string;
    properties?: { hashed_token?: string };
  };
  const hashedToken =
    payload.properties?.hashed_token ?? payload.hashed_token ?? null;
  if (!hashedToken) {
    throw new Error(`No hashed_token in generate_link response: ${JSON.stringify(payload)}`);
  }

  // Exchange the token with GoTrue through @supabase/ssr so the session is
  // serialized into the exact cookie format the app's middleware expects.
  const cookieJar: { name: string; value: string }[] = [];
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieJar;
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          cookieJar.push({ name, value });
        }
      },
    },
  });

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  });
  if (verifyError) {
    throw new Error(`verifyOtp failed: ${verifyError.message}`);
  }
  if (cookieJar.length === 0) {
    throw new Error("verifyOtp succeeded but no session cookies were produced");
  }

  await page.context().addCookies(
    cookieJar.map(({ name, value }) => ({
      name,
      value,
      url: baseURL,
    }))
  );

  // Hop to the org home so the saved storageState reflects an authenticated
  // session that can reach org-scoped routes without redirect-to-login.
  await page.goto(`/${orgSlug}`);
  await page.waitForURL((url) => url.pathname.includes(orgSlug), { timeout: 30000 });

  expect(page.url()).not.toContain("/auth/login");

  await page.context().storageState({ path: authFile });
});
