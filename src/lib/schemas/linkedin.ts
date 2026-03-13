import { z } from "zod";

// Response from POST /api/linkedin/sync
export const linkedinSyncResponseSchema = z.object({
  success: z.boolean(),
  profile: z
    .object({
      sub: z.string(),
      givenName: z.string(),
      familyName: z.string(),
      email: z.string(),
      picture: z.string().nullable(),
      emailVerified: z.boolean(),
    })
    .optional(),
  error: z.string().optional(),
});

export type LinkedInSyncResponse = z.infer<typeof linkedinSyncResponseSchema>;

// Connection status shape returned to frontend
export const linkedinConnectionStatusSchema = z.object({
  connected: z.boolean(),
  linkedinEmail: z.string().nullable().optional(),
  linkedinName: z.string().nullable().optional(),
  linkedinPictureUrl: z.string().nullable().optional(),
  status: z.enum(["connected", "disconnected", "error"]).optional(),
  tokenExpired: z.boolean().optional(),
});

export type LinkedInConnectionStatus = z.infer<typeof linkedinConnectionStatusSchema>;
