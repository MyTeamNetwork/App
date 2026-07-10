import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatPrepareChatMessageResponse } from "@/app/api/ai/[orgId]/chat/handler/formatters/prepares";

describe("formatPrepareChatMessageResponse", () => {
  it("renders recipient_unavailable copy with the requested recipient", () => {
    const out = formatPrepareChatMessageResponse({
      state: "missing_fields",
      clarification_kind: "recipient_unavailable",
      requested_recipient: "Matthew McKillop",
    });

    assert.ok(out);
    assert.match(out, /Matthew McKillop/);
    assert.match(out, /Members page/);
  });

  it("renders recipient_unavailable copy without a requested recipient", () => {
    const out = formatPrepareChatMessageResponse({
      state: "missing_fields",
      clarification_kind: "recipient_unavailable",
    });

    assert.ok(out);
    assert.match(out, /Members page/);
  });
});
