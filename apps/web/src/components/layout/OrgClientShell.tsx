"use client";

import dynamic from "next/dynamic";
import { DeferredAIPanel } from "@/components/ai-assistant/DeferredAIPanel";

export const AIPanel = DeferredAIPanel;

export const AIEdgeTab = dynamic(
  () => import("@/components/ai-assistant/AIEdgeTab").then((m) => m.AIEdgeTab),
  { ssr: false },
);

export const OrgGlobalSearch = dynamic(
  () => import("@/components/search/OrgGlobalSearch").then((m) => m.OrgGlobalSearch),
  { ssr: false },
);
