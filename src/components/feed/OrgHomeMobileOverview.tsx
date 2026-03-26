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

        <div className="border-b border-border/40 px-4 py-3.5 sm:px-5">
          <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            At a glance
          </p>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">Key stats for your organization</p>
        </div>

        {statChips.length > 0 && (
          <div className="px-4 pb-4 pt-4 sm:px-5">
            <div className="grid grid-cols-2 gap-3" role="list">
              {statChips.map((chip, index) => {
                const Icon = STAT_ICONS[chip.iconKey];
                const oddLast = statChips.length % 2 === 1 && index === statChips.length - 1;
                return (
                  <Link
                    key={chip.label}
                    href={chip.href}
                    role="listitem"
                    className={`flex min-h-[52px] flex-col justify-center gap-2 rounded-xl border border-border/50 bg-background/50 px-4 py-3.5 text-left shadow-sm transition-colors hover:border-primary/35 hover:bg-muted/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                      oddLast
                        ? "col-span-2 w-[calc(50%-0.375rem)] max-w-none justify-self-center"
                        : "min-w-0"
                    }`}
                  >
                    <span className="flex items-start gap-2 text-[11px] font-mono uppercase leading-relaxed tracking-wide text-muted-foreground">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/30 text-primary/80 ring-1 ring-border/40">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 break-words pt-0.5 [overflow-wrap:anywhere]">{chip.label}</span>
                    </span>
                    <span className="break-words pl-9 text-base font-semibold font-mono tabular-nums leading-snug tracking-tight text-foreground [overflow-wrap:anywhere]">
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
          className="flex min-h-[48px] w-full items-center justify-center gap-2 border-t border-border/50 bg-muted/15 px-4 py-3.5 text-sm font-medium text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:ring-offset-0"
        >
          <LayoutDashboard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-balance">{widgetsOpen ? "Hide events & announcements" : "Show events & announcements"}</span>
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
            <div className="space-y-4 border-t border-border/40 bg-card/30 px-4 pb-5 pt-4 sm:px-5">{children}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
