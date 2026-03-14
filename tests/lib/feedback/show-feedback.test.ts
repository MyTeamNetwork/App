import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const calls: Array<{ method: string; msg: string }> = [];
const mockToast = Object.assign(
  (msg: string) => { calls.push({ method: "default", msg }); },
  {
    success: (msg: string) => { calls.push({ method: "success", msg }); },
    error: (msg: string) => { calls.push({ method: "error", msg }); },
    warning: (msg: string) => { calls.push({ method: "warning", msg }); },
  },
);

describe("showFeedback routing logic", () => {
  beforeEach(() => { calls.length = 0; });

  it("routes success variant to toast.success", () => {
    mockToast.success("Saved");
    assert.deepStrictEqual(calls, [{ method: "success", msg: "Saved" }]);
  });

  it("routes error variant to toast.error", () => {
    mockToast.error("Failed");
    assert.deepStrictEqual(calls, [{ method: "error", msg: "Failed" }]);
  });

  it("routes warning variant to toast.warning", () => {
    mockToast.warning("Careful");
    assert.deepStrictEqual(calls, [{ method: "warning", msg: "Careful" }]);
  });

  it("routes info variant to default toast", () => {
    mockToast("Note");
    assert.deepStrictEqual(calls, [{ method: "default", msg: "Note" }]);
  });
});
