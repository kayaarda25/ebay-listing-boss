import { DashboardLayout } from "@/components/DashboardLayout";
import { ScrollText } from "lucide-react";

const LogsPage = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            System- und API-Protokolle
          </p>
        </div>

        <div className="glass-card py-16 flex flex-col items-center gap-3">
          <ScrollText className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Logs werden verfügbar, sobald Sync-Jobs aktiviert sind.
          </p>
          <p className="text-xs text-muted-foreground">
            Verbinde zuerst einen eBay-Account unter Settings.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default LogsPage;
