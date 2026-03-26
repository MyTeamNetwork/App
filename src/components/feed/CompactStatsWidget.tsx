import { Card } from "@/components/ui/Card";
import { StatRowLink } from "@/components/feed/StatRowLink";
import type { StatItem } from "@/components/feed/stat-item-types";

export type { StatItem } from "@/components/feed/stat-item-types";

interface CompactStatsWidgetProps {
  stats: StatItem[];
}

export function CompactStatsWidget({ stats }: CompactStatsWidgetProps) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Overview
        </h3>
      </div>
      <div className="divide-y divide-border/50">
        {stats.map((stat) => (
          <StatRowLink key={stat.label} href={stat.href} label={stat.label} value={stat.value} icon={stat.icon} />
        ))}
      </div>
    </Card>
  );
}
