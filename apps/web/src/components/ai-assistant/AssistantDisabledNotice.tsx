import { Wrench } from "lucide-react";
import {
  ASSISTANT_DISABLED_MESSAGE,
  ASSISTANT_DISABLED_TITLE,
} from "@/lib/ai/assistant-availability";

/**
 * Shown in place of the chat + input on both assistant surfaces while the
 * assistant is globally disabled (see `assistant-availability.ts`).
 */
export function AssistantDisabledNotice() {
  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-org-secondary/10">
        <Wrench className="h-6 w-6 text-org-secondary" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">
          {ASSISTANT_DISABLED_TITLE}
        </h3>
        <p className="max-w-xs text-xs text-muted-foreground">
          {ASSISTANT_DISABLED_MESSAGE}
        </p>
      </div>
    </div>
  );
}
