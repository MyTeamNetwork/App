// Strips chain-of-thought reasoning that Amazon Nova (notably Nova Micro on
// tool-routing turns) emits as a leading `<thinking>...</thinking>` text block
// before its tool call. That reasoning is model-internal — it narrates an
// *intention* to call a tool ("I will use the list_members tool to...") and
// must never reach the user or be persisted as the assistant's answer. The
// prior GLM provider did not surface raw reasoning this way, so nothing
// downstream expects or removes it; this is the single choke point.
//
// Operates on a complete buffered string (pass-1 and pass-2 content are both
// buffered before emission), so no cross-chunk state is needed.

// Matches a complete <thinking>...</thinking> or <think>...</think> block,
// case-insensitive, across newlines, non-greedy so multiple blocks each match.
const CLOSED_REASONING_BLOCK = /<(thinking|think)>[\s\S]*?<\/\1>/gi;

// Matches an unclosed reasoning block running to end-of-string — happens when
// the model is cut off mid-reasoning by a token cap.
const UNCLOSED_REASONING_TAIL = /<(thinking|think)>[\s\S]*$/i;

/**
 * Remove model reasoning blocks from text. Returns the visible answer with
 * surrounding whitespace collapsed, or "" if the text was reasoning-only
 * (the common case for a Nova Micro tool-routing turn, where the entire
 * pass-1 body is the `<thinking>` block).
 */
export function stripModelReasoning(text: string): string {
  // Case-insensitive fast path: skip the regex work when there is no tag.
  if (!text || !/<think/i.test(text)) {
    return text;
  }
  return text
    .replace(CLOSED_REASONING_BLOCK, "")
    .replace(UNCLOSED_REASONING_TAIL, "")
    .trim();
}
