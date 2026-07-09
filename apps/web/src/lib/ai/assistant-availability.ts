/**
 * Global kill switch for the AI assistant surfaces (side panel + full-page).
 *
 * Flip `ASSISTANT_TEMPORARILY_DISABLED` to `true` to take the assistant
 * offline everywhere without ripping out the UI. When disabled, both surfaces
 * render a notice and block input instead of talking to the AI backend.
 */
export const ASSISTANT_TEMPORARILY_DISABLED = false;

export const ASSISTANT_DISABLED_TITLE = "Assistant temporarily disabled";
export const ASSISTANT_DISABLED_MESSAGE =
  "The AI assistant is offline for maintenance right now. Please check back soon.";
export const ASSISTANT_DISABLED_CODE = "ASSISTANT_DISABLED";

export function getAssistantDisabledPayload() {
  return {
    error: ASSISTANT_DISABLED_MESSAGE,
    title: ASSISTANT_DISABLED_TITLE,
    code: ASSISTANT_DISABLED_CODE,
  };
}
