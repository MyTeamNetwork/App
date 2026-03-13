export const LINKEDIN_INTEGRATION_DISABLED_CODE = "linkedin_integration_disabled";

export interface LinkedInIntegrationStatus {
  oauthAvailable: boolean;
  reason: "not_configured" | null;
}

export function getLinkedInIntegrationDisabledMessage(): string {
  return "LinkedIn integration is not configured. Please contact support.";
}
