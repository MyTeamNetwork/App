import { NextResponse } from "next/server";
import { exchangeCodeForTokens, getBlackbaudSubscriptionKey } from "@/lib/blackbaud/oauth";
import { getAppUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const appUrl = getAppUrl();
  const redirectUri = `${appUrl}/api/blackbaud/callback`;
  const subKey = getBlackbaudSubscriptionKey();

  // Test: call the REAL exchangeCodeForTokens with a fake code
  let exchangeResult: { status?: number; error: string } | { success: true };
  try {
    await exchangeCodeForTokens("fake_diagnostic_code");
    exchangeResult = { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    exchangeResult = { error: msg };
  }

  return NextResponse.json({
    appUrl,
    redirectUri,
    subKeyPrefix: subKey.substring(0, 8),
    subKeyLen: subKey.length,
    exchangeResult,
  });
}
