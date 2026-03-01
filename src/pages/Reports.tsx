import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { FileText, Package, ShoppingCart, Search, Zap, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

interface ReportEntry {
  id: string;
  report_type: string;
  summary: string;
  details: { icon: string; text: string }[];
  stats: Record<string, number>;
  created_at: string;
}

const ICON_MAP: Record<string, typeof Package> = {
  discovery: Search,
  listing: Package,
  order: ShoppingCart,
  fulfillment: CheckCircle2,
  tracking: RefreshCw,
  optimize: Zap,
  error: AlertTriangle,
  info: FileText,
};

function ReportIcon({ name }: { name: string }) {
  const Icon = ICON_MAP[name] || FileText;
  const colorMap: Record<string, string> = {
    discovery: "text-blue-500",
    listing: "text-primary",
    order: "text-amber-500",
    fulfillment: "text-emerald-500",
    tracking: "text-cyan-500",
    optimize: "text-purple-500",
    error: "text-destructive",
    info: "text-muted-foreground",
  };
  return <Icon className={`w-4 h-4 flex-shrink-0 ${colorMap[name] || "text-muted-foreground"}`} />;
}

const ReportsPage = () => {
  const { sellerId } = useAuth();

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["autopilot-reports", sellerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("autopilot_reports")
        .select("*")
        .eq("seller_id", sellerId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as ReportEntry[];
    },
    enabled: !!sellerId,
    refetchInterval: 30_000,
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div>
          <h1 className="text-[28px] font-bold text-foreground tracking-tight">Autopilot Reports</h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            Automatische Aktivitätsberichte vom Autopiloten
          </p>
        </div>

        <div className="glass-card overflow-hidden">
          {isLoading ? (
            <div className="py-16 text-center text-[14px] text-muted-foreground">Laden...</div>
          ) : reports.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <FileText className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-[14px] text-muted-foreground">
                Noch keine Reports. Aktiviere den Autopiloten, um automatische Berichte zu erhalten.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {reports.map((report) => (
                <div key={report.id} className="p-5 hover:bg-muted/30 transition-colors">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Zap className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-[14px] font-semibold text-foreground">{report.summary}</p>
                        <p className="text-[12px] text-muted-foreground">
                          {formatDistanceToNow(new Date(report.created_at), { addSuffix: true, locale: de })}
                        </p>
                      </div>
                    </div>

                    {/* Stats Pills */}
                    {report.stats && Object.keys(report.stats).length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        {Object.entries(report.stats).map(([key, val]) => (
                          <span
                            key={key}
                            className="px-2.5 py-1 rounded-lg bg-muted text-[12px] font-mono font-medium text-foreground"
                          >
                            {key}: {val}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Detail Lines */}
                  {report.details && report.details.length > 0 && (
                    <div className="ml-10 space-y-1.5">
                      {report.details.map((detail, i) => (
                        <div key={i} className="flex items-start gap-2 text-[13px]">
                          <ReportIcon name={detail.icon} />
                          <span className="text-muted-foreground">{detail.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ReportsPage;
