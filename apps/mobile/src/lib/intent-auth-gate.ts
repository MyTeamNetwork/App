import type { Intent } from "@/lib/deep-link";

/** App destinations must wait for auth restoration; auth callbacks must not. */
export function requiresAuthenticatedSession(intent: Intent): boolean {
  switch (intent.kind) {
    case "join-org":
    case "event":
    case "event-checkin":
    case "announcement":
    case "shortcut":
    case "wallet-add":
      return true;
    case "auth-handoff":
    case "auth-error":
    case "auth-pkce":
    case "auth-implicit":
    case "auth-oauth-error":
    case "claim":
    case "ignored":
    case "unknown":
      return false;
  }
}
