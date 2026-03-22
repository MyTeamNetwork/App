import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("AI panel SSR integration", () => {
  it("dynamically imports AIPanel with SSR disabled in the org layout", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/app/[orgSlug]/layout.tsx", "utf-8");

    assert.ok(code.includes('ssr: false'), "layout should disable SSR for AIPanel");
    assert.ok(code.includes('next/dynamic'), "layout should dynamically import AIPanel");
  });
});

describe("AI panel post-stream refresh", () => {
  it("loads messages silently after handleSend to prevent loading flash", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync(
      "src/components/ai-assistant/AIPanel.tsx",
      "utf-8"
    );

    // The post-stream loadMessages call inside handleSend must pass { silent: true }
    // to prevent the message list from flashing a spinner after streaming completes.
    assert.ok(
      code.includes("loadMessages(result.threadId, { silent: true })"),
      "handleSend should call loadMessages with { silent: true } to avoid post-stream spinner flash"
    );
  });

  it("skips redundant effect load when handleSend sets a new thread id", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync(
      "src/components/ai-assistant/AIPanel.tsx",
      "utf-8"
    );

    // When handleSend changes activeThreadId, the useEffect would fire and show
    // a spinner. skipEffectLoadRef prevents this redundant load.
    assert.ok(
      code.includes("skipEffectLoadRef.current = true"),
      "handleSend should set skipEffectLoadRef before changing activeThreadId"
    );
    assert.ok(
      code.includes("skipEffectLoadRef.current") &&
        code.includes("skipEffectLoadRef.current = false"),
      "useEffect should check and reset skipEffectLoadRef"
    );
  });
});
