"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

interface AcceptTermsClientProps {
  redirectTo: string;
  /** Present when the interstitial was reached from a mobile auth callback:
   *  acceptance mints a challenge-bound handoff and deep-links back to the app. */
  mobileHandoffChallenge?: string | null;
}

export function AcceptTermsClient({ redirectTo, mobileHandoffChallenge }: AcceptTermsClientProps) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accepted) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mobileHandoffChallenge
            ? { accepted: true, mobile: true, handoff_challenge: mobileHandoffChallenge }
            : { accepted: true },
        ),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to accept terms");
        setIsLoading(false);
        return;
      }

      if (mobileHandoffChallenge) {
        const data = await response.json();
        if (typeof data.handoffDeepLink === "string" && data.handoffDeepLink.startsWith("teammeet://")) {
          // Hand the session back to the app; keep the button in its loading
          // state while the OS switches apps.
          window.location.assign(data.handoffDeepLink);
          return;
        }
        setError("Could not return to the app. Please open the app and sign in.");
        setIsLoading(false);
        return;
      }

      router.push(redirectTo);
    } catch {
      setError("Something went wrong. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        <div className="space-y-2 text-sm text-white/60">
          <p>By continuing, you agree to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <Link href="/terms" target="_blank" className="text-white underline hover:text-white/80">
                Terms of Service
              </Link>
            </li>
            <li>
              <Link href="/privacy" target="_blank" className="text-white underline hover:text-white/80">
                Privacy Policy
              </Link>
            </li>
          </ul>
        </div>

        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            id="accept-terms"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-white/20 bg-white/5 text-[#22c55e] focus:ring-[#22c55e]"
            data-testid="accept-terms-checkbox"
          />
          <label htmlFor="accept-terms" className="text-sm text-white/50">
            I have read and agree to the Terms of Service and Privacy Policy
          </label>
        </div>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <Button
          type="submit"
          className="w-full"
          isLoading={isLoading}
          disabled={!accepted}
          data-testid="accept-terms-submit"
        >
          Continue
        </Button>
      </div>
    </form>
  );
}
