import { setStageStatus, type AiAuditStageTimings } from "@/lib/ai/chat-telemetry";
import type {
  composeResponse,
  ToolCallRequestedEvent,
} from "@/lib/ai/response-composer";
import type { SSEEvent } from "@/lib/ai/sse";
import type { AiLogContext } from "@/lib/ai/logger";
import { createStageAbortSignal, isStageTimeoutError } from "@/lib/ai/timeout";
import type { TurnRuntimeState } from "../sse-runtime";

export type ModelStageOutcome =
  | "completed"
  | "stopped"
  | "stopped_error"
  | "timeout"
  | "aborted";

export interface RunModelStageInput {
  stage: "pass1_model" | "pass2_model";
  auditStage: "pass1_model" | "pass2";
  timeoutMs: number;
  options: Parameters<typeof composeResponse>[0];
  onEvent: (
    event: SSEEvent | ToolCallRequestedEvent,
  ) =>
    | Promise<"continue" | "stop" | "stop_error">
    | "continue"
    | "stop"
    | "stop_error";

  composeResponseFn: typeof composeResponse;
  stageTimings: AiAuditStageTimings;
  streamSignal: AbortSignal;
  threadId: string;
  requestLogContext: AiLogContext;
  runtimeState: TurnRuntimeState;
  emitTimeoutError: () => void;
}

export async function runModelStage(
  input: RunModelStageInput,
): Promise<ModelStageOutcome> {
  const stageSignal = createStageAbortSignal({
    stage: input.stage,
    timeoutMs: input.timeoutMs,
    parentSignal: input.streamSignal,
  });
  const stageStartedAt = Date.now();

  try {
    for await (const event of input.composeResponseFn({
      ...input.options,
      signal: stageSignal.signal,
      logContext: { ...input.requestLogContext, threadId: input.threadId },
    })) {
      const disposition = await input.onEvent(
        event as SSEEvent | ToolCallRequestedEvent,
      );
      if (disposition === "stop" || disposition === "stop_error") {
        // An error-stop must be legible as a failure in ai_audit_log — the
        // Bedrock migration incident logged instantly-rejected pass-2 calls
        // as "completed", which hid the outage.
        setStageStatus(
          input.stageTimings,
          input.auditStage,
          disposition === "stop_error" ? "failed" : "completed",
          Date.now() - stageStartedAt,
        );
        return disposition === "stop_error" ? "stopped_error" : "stopped";
      }
    }
    setStageStatus(
      input.stageTimings,
      input.auditStage,
      "completed",
      Date.now() - stageStartedAt,
    );
    return "completed";
  } catch (err) {
    const failureReason = stageSignal.signal.reason ?? err;
    if (isStageTimeoutError(failureReason)) {
      setStageStatus(
        input.stageTimings,
        input.auditStage,
        "timed_out",
        Date.now() - stageStartedAt,
      );
      input.runtimeState.auditErrorMessage = `${input.stage}:timeout`;
      input.emitTimeoutError();
      return "timeout";
    }
    if (input.streamSignal.aborted || stageSignal.signal.aborted) {
      setStageStatus(
        input.stageTimings,
        input.auditStage,
        "aborted",
        Date.now() - stageStartedAt,
      );
      input.runtimeState.auditErrorMessage = `${input.stage}:request_aborted`;
      return "aborted";
    }
    setStageStatus(
      input.stageTimings,
      input.auditStage,
      "failed",
      Date.now() - stageStartedAt,
    );
    throw err;
  } finally {
    stageSignal.cleanup();
  }
}
