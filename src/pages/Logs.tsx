import { DashboardLayout } from "@/components/DashboardLayout";
import { LogBadge } from "@/components/StatusBadge";
import { mockLogs } from "@/lib/mock-data";
import { Search } from "lucide-react";
import { useState } from "react";

const LogsPage = () => {
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");

  const filtered = mockLogs.filter((l) => {
    const matchSearch =
      l.message.toLowerCase().includes(search.toLowerCase()) ||
      l.category.toLowerCase().includes(search.toLowerCase());
    const matchLevel = levelFilter === "all" || l.level === levelFilter;
    return matchSearch && matchLevel;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            System- und API-Protokolle
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Logs durchsuchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-1 bg-card border border-border rounded-md p-0.5">
            {["all", "error", "warning", "info"].map((s) => (
              <button
                key={s}
                onClick={() => setLevelFilter(s)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  levelFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "Alle" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Logs */}
        <div className="glass-card divide-y divide-border">
          {filtered.map((log) => (
            <div key={log.id} className="px-4 py-3 flex items-start gap-3 hover:bg-surface-hover transition-colors">
              <LogBadge level={log.level} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">{log.message}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs font-mono text-primary">{log.category}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">{log.seller}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs font-mono text-muted-foreground">{log.timestamp}</span>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Keine Logs gefunden.
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default LogsPage;
