import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthHeader } from "@/components/auth/AuthHeader";
import { Card } from "@/components/ui";
import {
  hasAcceptedCurrentAgreementVersions,
  type UserAgreementVersion,
} from "@/lib/compliance/user-agreements";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { AcceptTermsClient } from "./AcceptTermsClient";

interface AcceptTermsPageProps {
  searchParams: Promise<{ redirect?: string; mobile?: string; handoff_challenge?: string }>;
}

const MOBILE_HANDOFF_CHALLENGE_PATTERN = /^[0-9a-f]{64}$/i;

export default async function AcceptTermsPage({ searchParams }: AcceptTermsPageProps) {
  const { redirect: redirectTo, mobile, handoff_challenge: rawChallenge } = await searchParams;
  const safeRedirectTo = sanitizeRedirectPath(redirectTo ?? null);
  // Mobile mode requires a well-formed device challenge: a malformed one means
  // a tampered URL, so fall back to the plain web flow rather than minting an
  // unbound handoff (mirrors the builder's reject-don't-downgrade behavior).
  const handoffChallenge =
    typeof rawChallenge === "string" && MOBILE_HANDOFF_CHALLENGE_PATTERN.test(rawChallenge)
      ? rawChallenge.toLowerCase()
      : null;
  const isMobile = mobile === "1" && handoffChallenge !== null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Skip the interstitial once both current agreement versions are present.
  // Mobile flows still render it: acceptance is idempotent server-side, and the
  // accept-terms API response carries the deep link that returns the session to
  // the app — redirecting to a web route would strand the user in the browser.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: agreements } = await (supabase as any)
    .from("user_agreements")
    .select("agreement_type, version")
    .eq("user_id", user.id) as {
    data: UserAgreementVersion[] | null;
  };

  if (!isMobile && hasAcceptedCurrentAgreementVersions(agreements ?? [])) {
    redirect(safeRedirectTo);
  }

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle="Terms of Service" />

        <Card className="p-6">
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold text-white mb-2">
              Accept Terms to Continue
            </h2>
            <p className="text-white/50 text-sm">
              Please review and accept our Terms of Service and Privacy Policy to continue.
            </p>
          </div>

          <AcceptTermsClient
            redirectTo={safeRedirectTo}
            mobileHandoffChallenge={isMobile ? handoffChallenge : null}
          />
        </Card>
      </div>
    </div>
  );
}
