import type { z } from "zod";
import type { sendMessageSchema } from "@/lib/schemas/ai-assistant";

type AiSurface = z.infer<typeof sendMessageSchema>["surface"];

const SURFACE_PREFIXES: ReadonlyArray<readonly [string, AiSurface]> = [
  ["/members", "members"],
  ["/alumni", "members"],
  ["/parents", "members"],
  ["/mentorship", "members"],
  ["/events", "events"],
  ["/calendar", "events"],
  ["/philanthropy", "analytics"],
  ["/donations", "analytics"],
  ["/expenses", "analytics"],
  ["/analytics", "analytics"],
];

/**
 * Derive AI surface from pathname. Extracts the second path segment
 * (the feature segment after /{orgSlug}/) and maps it to a surface.
 */
export function routeToSurface(pathname: string): AiSurface {
  const match = pathname.match(/^\/[^/]+(\/[^/?#]*)/);
  const segment = match?.[1] ?? "";
  for (const [prefix, surface] of SURFACE_PREFIXES) {
    if (segment === prefix || segment.startsWith(prefix + "/")) {
      return surface;
    }
  }
  return "general";
}
