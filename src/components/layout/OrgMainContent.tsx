"use client";

import { usePathname } from "next/navigation";

interface OrgMainContentProps {
  children: React.ReactNode;
  hasTopBanner: boolean;
}

export function OrgMainContent({ children, hasTopBanner }: OrgMainContentProps) {
  const pathname = usePathname();
  const isMessages = pathname.includes("/messages");

  return (
    <main
      className={`lg:ml-64 ${
        isMessages
          ? "h-[calc(100dvh-4rem)] overflow-hidden pt-[calc(4rem+env(safe-area-inset-top,0px))] lg:h-dvh lg:pt-0"
          : "p-4 pt-[calc(4rem+env(safe-area-inset-top,0px)+1rem)] lg:p-8 lg:pt-8"
      } ${hasTopBanner ? "mt-12" : ""}`}
    >
      {children}
    </main>
  );
}
