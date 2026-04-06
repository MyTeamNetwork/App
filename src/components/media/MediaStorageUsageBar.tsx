"use client";

import { useEffect, useState } from "react";

interface MediaStorageUsageBarProps {
  orgId: string;
  isAdmin: boolean;
}

interface StorageStats {
  allowed: boolean;
  total_bytes?: number;
  quota_bytes?: number | null;
  usage_percent?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function MediaStorageUsageBar({ orgId, isAdmin }: MediaStorageUsageBarProps) {
  const [stats, setStats] = useState<StorageStats | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/media/storage-stats?orgId=${encodeURIComponent(orgId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as StorageStats;
        if (!cancelled) setStats(data);
      } catch {
        // Soft-fail: usage bar is informational, never block the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, isAdmin]);

  if (!isAdmin || !stats || !stats.allowed) return null;
  if (stats.quota_bytes == null) return null; // unlimited (enterprise)

  const used = stats.total_bytes ?? 0;
  const quota = stats.quota_bytes;
  const percent = stats.usage_percent ?? 0;
  const clampedPercent = Math.min(100, Math.max(0, percent));

  let barColor = "bg-muted-foreground/60";
  let textColor = "text-muted-foreground";
  if (percent >= 90) {
    barColor = "bg-red-500";
    textColor = "text-red-600 dark:text-red-400";
  } else if (percent >= 75) {
    barColor = "bg-amber-500";
    textColor = "text-amber-600 dark:text-amber-400";
  }

  return (
    <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-foreground">Media storage</span>
        <span className={`text-sm ${textColor}`}>
          {formatBytes(used)} of {formatBytes(quota)} used ({percent.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
    </div>
  );
}
