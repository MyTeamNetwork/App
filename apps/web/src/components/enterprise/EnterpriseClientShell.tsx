"use client";

import dynamic from "next/dynamic";
import { DeferredAIPanel } from "@/components/ai-assistant/DeferredAIPanel";

export const AIPanel = DeferredAIPanel;

export const AIEdgeTab = dynamic(
  () => import("@/components/ai-assistant/AIEdgeTab").then((module) => module.AIEdgeTab),
  { ssr: false },
);
