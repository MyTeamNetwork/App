import { captureSanitized } from "@/lib/errors/sanitize";

export interface AiLogContext {
  requestId: string;
  orgId: string;
  threadId?: string;
  userId?: string;
}

export function aiLog(
  level: "warn" | "error" | "info",
  module: string,
  message: string,
  ctx: AiLogContext,
  extra?: Record<string, unknown>
): void {
  const method = level === "info" ? "log" : level;
  console[method](`[${module}] ${message}`, {
    requestId: ctx.requestId,
    orgId: ctx.orgId,
    ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(extra ?? {}),
  });

  if (level === "error") {
    // Additive, fire-and-forget capture into error_groups/error_events.
    // The sanitization boundary bounds the message, allowlists meta (raw
    // `extra` never passes through), and is recursion-safe — console logging
    // above is untouched either way.
    const caught = extra?.error;
    captureSanitized(caught ?? message, {
      messagePrefix: caught !== undefined && caught !== null ? message : undefined,
      fallbackName: "AiModuleError",
      context: {
        requestId: ctx.requestId,
        orgId: ctx.orgId,
        threadId: ctx.threadId,
        userId: ctx.userId,
        module,
      },
    });
  }
}
