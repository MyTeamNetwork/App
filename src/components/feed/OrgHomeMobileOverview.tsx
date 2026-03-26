"use client";

import { useCallback, useId, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  ChevronDown,
  GraduationCap,
  HandHeart,
  Heart,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { MobileStatChip } from "@/components/feed/feed-mobile-stat-types";

const STAT_ICONS: Record<MobileStatChip["iconKey"], LucideIcon> = {
  users: Users,
  "graduation-cap": GraduationCap,
  heart: Heart,
  "calendar-clock": CalendarClock,
  "hand-heart": HandHeart,
};

interface OrgHomeMobileOverviewProps {
  statChips: MobileStatChip[];
  children: React.ReactNode;
}

/**
 * Below-xl overview: stats grid always visible; events / announcements / members behind expand (default collapsed).
 */
export function OrgHomeMobileOverview({ statChips, children }: OrgHomeMobileOverviewProps) {
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const panelId = useId();
  const toggle = useCallback(() => setWidgetsOpen((o) => !o), []);

  return (
    <section
      className="mb-5 xl:hidden"
      data-testid="org-home-mobile-overview"
      aria-label="Organization overview"
    >
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-b from-card/90 via-card/70 to-card/40 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent"
          aria-hidden
        />

        <div className="border-b border-border/40 px-4 py-3">
          <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            At a glance
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">Key stats for your organization</p>
        </div>

        {statChips.length > 0 && (
          <div className="px-4 pb-3 pt-3">
            <div className="grid grid-cols-2 gap-2" role="list">
              {statChips.map((chip) => {
                const Icon = STAT_ICONS[chip.iconKey];
                return (
                  <Link
                    key={chip.label}
                    href={chip.href}
                    role="listitem"
                    className="flex min-h-[44px] flex-col justify-center gap-1 rounded-xl border border-border/50 bg-background/40 px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                  >
                    <span className="flex items-start gap-1.5 text-[10px] font-mono uppercase leading-snug tracking-wide text-muted-foreground">
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{chip.label}</span>
                    </span>
                    <span className="break-words text-sm font-semibold font-mono tabular-nums leading-snug text-foreground [overflow-wrap:anywhere]">
                      {chip.value}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={toggle}
          aria-expanded={widgetsOpen}
          aria-controls={panelId}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 border-t border-border/40 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <LayoutDashboard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{widgetsOpen ? "Hide events & announcements" : "Show events & announcements"}</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${widgetsOpen ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>

        <div
          id={panelId}
          role="region"
          aria-label="Events, announcements, and members"
          aria-hidden={!widgetsOpen}
          className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${widgetsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-4 border-t border-border/40 px-4 pb-4 pt-2">{children}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
