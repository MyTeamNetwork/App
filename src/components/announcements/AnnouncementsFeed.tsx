"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Badge, Button, EmptyState } from "@/components/ui";
import { AnnouncementCard } from "./AnnouncementCard";
import type { Database } from "@/types/database";

type Announcement = Database["public"]["Tables"]["announcements"]["Row"];

interface AnnouncementsFeedProps {
  announcements: Announcement[];
  orgSlug: string;
  isAdmin: boolean;
  pageLabel: string;
  actionLabel: string;
}

const PAGE_SIZE = 10;

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
      />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function MegaphoneIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46"
      />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function filterAnnouncements(items: Announcement[], query: string): Announcement[] {
  if (!query.trim()) return items;
  const lower = query.toLowerCase();
  return items.filter(
    (a) =>
      a.title.toLowerCase().includes(lower) ||
      (a.body ?? "").toLowerCase().includes(lower)
  );
}

export function AnnouncementsFeed({
  announcements,
  orgSlug,
  isAdmin,
  pageLabel,
  actionLabel,
}: AnnouncementsFeedProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
      setVisibleCount(PAGE_SIZE);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const filtered = filterAnnouncements(announcements, debouncedQuery);
  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  function handleLoadMore() {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  }

  function handleClearSearch() {
    setQuery("");
    setDebouncedQuery("");
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{pageLabel}</h1>
          <Badge variant="muted">{filtered.length}</Badge>
        </div>
        {isAdmin && (
          <Link href={`/${orgSlug}/announcements/new`}>
            <Button>
              <PlusIcon className="h-4 w-4" />
              {actionLabel}
            </Button>
          </Link>
        )}
      </div>

      {/* Search bar — only shown when there are announcements */}
      {announcements.length > 0 && (
        <div className="relative mb-6">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <SearchIcon className="h-4 w-4 text-muted-foreground" />
          </div>
          <input
            type="search"
            className="input pl-10 w-full"
            placeholder={`Search ${pageLabel.toLowerCase()}…`}
            aria-label={`Search ${pageLabel}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {/* Feed list */}
      {visible.length > 0 && (
        <div className="space-y-4 stagger-children">
          {visible.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              orgSlug={orgSlug}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      {/* Load-more */}
      {hasMore && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={handleLoadMore}>
            <ChevronDownIcon className="h-4 w-4" />
            Load More
          </Button>
        </div>
      )}

      {/* Search empty state */}
      {filtered.length === 0 && debouncedQuery && (
        <EmptyState
          icon={<SearchIcon className="h-12 w-12" />}
          title="No results found"
          description={`No ${pageLabel} match "${debouncedQuery}"`}
          action={
            <Button variant="secondary" onClick={handleClearSearch}>
              Clear search
            </Button>
          }
        />
      )}

      {/* No announcements empty state */}
      {announcements.length === 0 && (
        <EmptyState
          icon={<MegaphoneIcon className="h-12 w-12" />}
          title={`No ${pageLabel} yet`}
          description={`${pageLabel} from your organization will appear here`}
          action={
            isAdmin ? (
              <Link href={`/${orgSlug}/announcements/new`}>
                <Button>Create First</Button>
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
