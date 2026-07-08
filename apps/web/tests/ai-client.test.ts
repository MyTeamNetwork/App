import test from "node:test";
import assert from "node:assert/strict";

test("getLlmModel defaults to Nova Micro", async () => {
  const previous = process.env.BEDROCK_MODEL;
  delete process.env.BEDROCK_MODEL;

  const { getLlmModel } = await import("../src/lib/ai/client.ts");

  assert.equal(getLlmModel(), "us.amazon.nova-micro-v1:0");

  if (previous === undefined) {
    delete process.env.BEDROCK_MODEL;
  } else {
    process.env.BEDROCK_MODEL = previous;
  }
});
