import type OpenAI from "openai";
import { createBedrockChatClient } from "@/lib/ai/bedrock-adapter";

// Cheapest Amazon Nova model — text only. Used for all non-vision calls.
const DEFAULT_LLM_MODEL = "us.amazon.nova-micro-v1:0";
// Cheapest Nova model with image support — used for the vision (schedule
// image extraction) path.
const DEFAULT_LLM_IMAGE_MODEL = "us.amazon.nova-lite-v1:0";

function validateLlmImageModel(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return DEFAULT_LLM_IMAGE_MODEL;
  }

  if (!/nova|amazon/i.test(normalized)) {
    throw new Error(
      `Invalid BEDROCK_IMAGE_MODEL value "${normalized}". Expected an Amazon Nova vision model such as ${DEFAULT_LLM_IMAGE_MODEL}.`
    );
  }

  return normalized;
}

/**
 * Returns whether the AI assistant is configured for this environment. Bedrock
 * needs an AWS region; credentials come from the standard AWS provider chain
 * (env vars / IAM role). Presence of the region is the "configured" signal,
 * mirroring the old ZAI_API_KEY check.
 */
export function isLlmConfigured(): boolean {
  return !!process.env.AWS_REGION;
}

export function createLlmClient(): OpenAI {
  if (!isLlmConfigured()) {
    throw new Error("AWS_REGION environment variable is required for AI assistant features");
  }

  // The adapter implements the slice of the OpenAI SDK the LLM wrapper uses.
  return createBedrockChatClient() as unknown as OpenAI;
}

export function getLlmModel(): string {
  return process.env.BEDROCK_MODEL || DEFAULT_LLM_MODEL;
}

export function getLlmImageModel(): string {
  return validateLlmImageModel(process.env.BEDROCK_IMAGE_MODEL || DEFAULT_LLM_IMAGE_MODEL);
}
