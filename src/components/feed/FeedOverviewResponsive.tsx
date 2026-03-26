"use client";

import { useCallback, useId, useState, useSyncExternalStore } from "react";
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
import type { FeedOverviewStatChip } from "@/components/feed/feed-overview-types";

const STAT_ICONS: Record<FeedOverviewStatChip["iconKey"], LucideIcon> = {
  users: Users,
  "graduation-cap": GraduationCap,
  heart: Heart,
  "calendar-clock": CalendarClock,
  "hand-heart": HandHeart,
};

const XL_MEDIA = "(min-width: 1280px)";

function subscribeXl(callback: () => void) {
  const mq = window.matchMedia(XL_MEDIA);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getXlSnapshot() {
  return window.matchMedia(XL_MEDIA).matches;
}

function getServerXlSnapshot() {
  return false;
}

function useIsXl() {
  return useSyncExternalStore(subscribeXl, getXlSnapshot, getServerXlSnapshot);
}

interface FeedOverviewResponsiveProps {
  statChips: FeedOverviewStatChip[];
  children: React.ReactNode;
}

/**
 * xl+: sticky feed rail (desktop).
 * Below xl: “At a glance” card — horizontal stat chips when collapsed; full overview + widgets when expanded.
 */
export function FeedOverviewResponsive({ statChips, children }: FeedOverviewResponsiveProps) {
  const isXl = useIsXl();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const toggle = useCallback(() => setExpanded((e) => !e), []);

  if (isXl) {
    return (
      <aside className="order-2 min-w-0 xl:sticky xl:top-8 xl:self-start">
        <div className="space-y-4">{children}</div>
      </aside>
    );
  }

  return (
    <aside className="order-2 min-w-0">
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-b from-card/90 via-card/70 to-card/40 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent"
          aria-hidden
        />

        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-muted/20 text-primary">
            <LayoutDashboard className="h-5 w-5 opacity-90" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              At a glance
            </span>
            <span className="block text-sm font-medium leading-tight text-foreground">
              {expanded ? "Hide stats & updates" : "Stats, events & announcements"}
            </span>
          </span>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>

        {!expanded && statChips.length > 0 && (
          <div className="border-t border-border/40 px-4 pb-4 pt-3">
            <p className="mb-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">
              Tap a metric or expand for full overview
            </p>
            <div
              className="grid grid-cols-2 gap-2"
              role="list"
              aria-label="Organization metrics"
            >
              {statChips.map((chip, index) => {
                const Icon = STAT_ICONS[chip.iconKey];
                const oddLast = statChips.length % 2 === 1;
                const isSoloLast = oddLast && index === statChips.length - 1;
                return (
                  <Link
                    key={chip.label}
                    href={chip.href}
                    role="listitem"
                    onClick={(e) => e.stopPropagation()}
                    className={`flex min-h-[44px] flex-col justify-center gap-1 rounded-xl border border-border/50 bg-background/40 px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                      isSoloLast ? "col-span-2 mx-auto w-full max-w-sm" : ""
                    }`}
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

        <div
          id={panelId}
          role="region"
          aria-label="Organization overview"
          aria-hidden={!expanded}
          className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-4 border-t border-border/40 px-4 pb-4 pt-4">{children}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
