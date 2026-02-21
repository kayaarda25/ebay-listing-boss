import { DashboardLayout } from "@/components/DashboardLayout";
import { ScrollText } from "lucide-react";

const LogsPage = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div>
          <h1 className="text-[28px] font-bold text-foreground tracking-tight">Logs</h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            System- und API-Protokolle
          </p>
        </div>

        <div className="glass-card py-20 flex flex-col items-center gap-4">
          <div className="p-4 rounded-2xl bg-muted">
            <ScrollText className="w-8 h-8 text-muted-foreground/50" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-[15px] font-medium text-muted-foreground">
              Noch keine Logs verfügbar
            </p>
            <p className="text-[13px] text-muted-foreground/70">
              Logs werden angezeigt, sobald Sync-Jobs aktiviert sind.
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default LogsPage;
