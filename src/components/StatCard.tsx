import { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  accent?: boolean;
}

export function StatCard({ label, value, icon: Icon, trend, trendUp, accent }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-[13px] text-muted-foreground font-medium">{label}</p>
          <p className={`text-[28px] font-bold tracking-tight leading-none ${accent ? "text-primary" : "text-foreground"}`}>
            {value}
          </p>
          {trend && (
            <p className={`text-xs font-medium mt-2 ${trendUp ? "text-success" : "text-destructive"}`}>
              {trend}
            </p>
          )}
        </div>
        <div className="p-2.5 rounded-xl bg-muted">
          <Icon className="w-[18px] h-[18px] text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
