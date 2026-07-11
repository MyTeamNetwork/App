import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { recordBothAgreements } from "@/lib/compliance/user-agreements";
import { hashIp, getClientIp } from "@/lib/compliance/audit-log";
import {
  buildMobileCallbackDeepLink,
  buildMobileHandoffInsert,
  normalizeMobileHandoffChallenge,
} from "@/lib/auth/mobile-oauth";
import {
  logMobileHandoffFailure,
  resolveHandoffEnv,
} from "@/lib/auth/mobile-handoff";
import {
  ValidationError,
  validateJson,
  validationErrorResponse,
} from "@/lib/security/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/accept-terms
 *
 * Records the authenticated user's acceptance of current ToS + Privacy Policy.
 * Called from the OAuth interstitial page and email signup callback.
 *
 * Mobile flows (`mobile: true`) arrive via the accept-terms interstitial opened
 * in the device browser by /auth/callback. After acceptance is recorded, this
 * route mints the one-time mobile handoff — bound to the device challenge the
 * app generated at signup — and returns the teammeet://callback deep link so
 * the browser can hand the session back to the app. The handoff is only ever
 * minted AFTER agreements are recorded, preserving the server-side terms gate.
 */
export async function POST(request: Request) {
  try {
    const body = await validateJson(
      request,
      z
        .object({
          accepted: z.literal(true),
          mobile: z.literal(true).optional(),
          handoff_challenge: z
            .string()
            .regex(/^[0-9a-f]{64}$/i)
            .optional(),
        })
        .refine(
          (payload) => !payload.mobile || payload.handoff_challenge !== undefined,
          {
            path: ["handoff_challenge"],
            message: "handoff_challenge is required for mobile requests",
          },
        ),
      { maxBodyBytes: 1_000 },
    );

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIp = getClientIp(request);
    const ipHash = clientIp ? hashIp(clientIp) : null;

    const success = await recordBothAgreements({
      userId: user.id,
      ipHash,
    });

    if (!success) {
      return NextResponse.json(
        { error: "Failed to record agreement" },
        { status: 500 },
      );
    }

    if (body.mobile) {
      // getUser() above verified the session with the auth server; getSession()
      // is only used to read the token pair the handoff must carry.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || session.user.id !== user.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const handoffChallenge = normalizeMobileHandoffChallenge(
        body.handoff_challenge ?? null,
      );
      const { code, row } = buildMobileHandoffInsert(
        session,
        undefined,
        handoffChallenge,
      );
      const { error: handoffError } = await createServiceClient()
        .from("mobile_auth_handoffs")
        .insert(row);

      if (handoffError) {
        logMobileHandoffFailure("Mobile handoff insert failed after terms acceptance", {
          category: "handoff_insert_error",
          env: resolveHandoffEnv(),
          reason: handoffError.message,
        });
        return NextResponse.json(
          { error: "Could not complete sign-in. Please try again." },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        handoffDeepLink: buildMobileCallbackDeepLink({
          handoff_code: code,
          handoff_challenge: handoffChallenge,
        }),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }

    return NextResponse.json(
      { error: "Failed to record agreement" },
      { status: 500 },
    );
  }
}
