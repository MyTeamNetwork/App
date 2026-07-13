"use client";

import { usePathname } from "next/navigation";
import { lazy, Suspense } from "react";
import { useAIPanel } from "./AIPanelContext";
import { isFullPageAssistantRoute } from "./route-surface";

const AIPanelContent = lazy(async () => {
  const { AIPanel } = await import("./AIPanel");
  return { default: AIPanel };
});

interface DeferredAIPanelProps {
  orgId: string;
}

export function DeferredAIPanel({ orgId }: DeferredAIPanelProps) {
  const { isOpen } = useAIPanel();
  const pathname = usePathname();

  if (!isOpen || isFullPageAssistantRoute(pathname)) return null;

  return (
    <Suspense fallback={null}>
      <AIPanelContent orgId={orgId} />
    </Suspense>
  );
}
