import { NextResponse } from "next/server";
import {
  ASSISTANT_TEMPORARILY_DISABLED,
  getAssistantDisabledPayload,
} from "@/lib/ai/assistant-availability";
import { createChatPostHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const chatPostHandler = createChatPostHandler();

export async function POST(
  request: Parameters<typeof chatPostHandler>[0],
  context: Parameters<typeof chatPostHandler>[1],
) {
  if (ASSISTANT_TEMPORARILY_DISABLED) {
    return NextResponse.json(getAssistantDisabledPayload(), { status: 503 });
  }

  return chatPostHandler(request, context);
}
