import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { StatusBadge, LogBadge } from "@/components/StatusBadge";
import { mockStats, mockListings, mockOrders, mockLogs } from "@/lib/mock-data";
import {
  Package,
  ShoppingCart,
  DollarSign,
  Pause,
  AlertTriangle,
  Activity,
  Users,
  ArrowRight,
} from "lucide-react";
import { Link } from "react-router-dom";

const Index = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Letzter Sync: {mockStats.lastSync} · {mockStats.sellersConnected} Seller verbunden
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Aktive Listings"
            value={mockStats.activeListings.toLocaleString()}
            icon={Package}
            trend="+23 diese Woche"
            trendUp
            accent
          />
          <StatCard
            label="Offene Orders"
            value={mockStats.openOrders}
            icon={ShoppingCart}
            trend="5 needs fulfillment"
          />
          <StatCard
            label="Umsatz 30 Tage"
            value={`€${mockStats.revenue30Days.toLocaleString("de-DE", { minimumFractionDigits: 2 })}`}
            icon={DollarSign}
            trend="+12.5% vs. Vormonat"
            trendUp
          />
          <StatCard
            label="Pausierte Listings"
            value={mockStats.pausedListings}
            icon={Pause}
          />
        </div>

        {/* API Health + Errors */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-md bg-success/10">
              <Activity className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">API Status</p>
              <p className="text-xs text-success font-mono">Healthy · 142ms avg</p>
            </div>
          </div>
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-md bg-destructive/10">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{mockStats.errorCount} Fehler</p>
              <p className="text-xs text-muted-foreground">Letzte 24 Stunden</p>
            </div>
          </div>
          <div className="stat-card flex items-center gap-4">
            <div className="p-3 rounded-md bg-primary/10">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{mockStats.sellersConnected} Seller</p>
              <p className="text-xs text-muted-foreground">Alle verbunden</p>
            </div>
          </div>
        </div>

        {/* Recent Listings */}
        <div className="glass-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Neueste Listings</h2>
            <Link to="/listings" className="text-xs text-primary hover:underline flex items-center gap-1">
              Alle anzeigen <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Titel</th>
                  <th>Status</th>
                  <th>Preis</th>
                  <th>Menge</th>
                  <th>Sync</th>
                </tr>
              </thead>
              <tbody>
                {mockListings.slice(0, 5).map((listing) => (
                  <tr key={listing.id}>
                    <td className="font-mono text-xs text-muted-foreground">{listing.sku}</td>
                    <td className="max-w-[250px] truncate">{listing.title}</td>
                    <td><StatusBadge status={listing.status} /></td>
                    <td className="font-mono">€{listing.price.toFixed(2)}</td>
                    <td className="font-mono">{listing.quantity}</td>
                    <td className="text-xs text-muted-foreground">{listing.lastSynced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Logs */}
        <div className="glass-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Letzte Logs</h2>
            <Link to="/logs" className="text-xs text-primary hover:underline flex items-center gap-1">
              Alle anzeigen <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {mockLogs.slice(0, 5).map((log) => (
              <div key={log.id} className="px-4 py-3 flex items-start gap-3">
                <LogBadge level={log.level} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{log.message}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                    {log.category} · {log.seller} · {log.timestamp}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Index;
