import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ASSISTANT_DISABLED_CODE,
  ASSISTANT_DISABLED_MESSAGE,
  ASSISTANT_DISABLED_TITLE,
  getAssistantDisabledPayload,
} from "../../../src/lib/ai/assistant-availability.ts";

test("disabled assistant payload is stable for API and UI callers", () => {
  assert.deepEqual(getAssistantDisabledPayload(), {
    error: ASSISTANT_DISABLED_MESSAGE,
    title: ASSISTANT_DISABLED_TITLE,
    code: ASSISTANT_DISABLED_CODE,
  });
});

test("AI chat route gates backend calls while assistant is globally disabled", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/app/api/ai/[orgId]/chat/route.ts"),
    "utf8",
  );

  assert.match(source, /ASSISTANT_TEMPORARILY_DISABLED/);
  assert.match(source, /getAssistantDisabledPayload\(\)/);
  assert.match(source, /status:\s*503/);
});
