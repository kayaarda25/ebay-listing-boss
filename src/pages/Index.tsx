import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/hooks/useAuth";
import { fetchDashboardStats, fetchListings, fetchOrders } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  Package,
  ShoppingCart,
  DollarSign,
  Pause,
  Activity,
  ArrowRight,
} from "lucide-react";
import { Link } from "react-router-dom";

const Index = () => {
  const { sellerId } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats", sellerId],
    queryFn: () => fetchDashboardStats(sellerId!),
    enabled: !!sellerId,
  });

  const { data: listings } = useQuery({
    queryKey: ["listings", sellerId],
    queryFn: () => fetchListings(sellerId!),
    enabled: !!sellerId,
  });

  const { data: orders } = useQuery({
    queryKey: ["orders", sellerId],
    queryFn: () => fetchOrders(sellerId!),
    enabled: !!sellerId,
  });

  const recentListings = (listings || []).slice(0, 5);
  const recentOrders = (orders || []).slice(0, 5);

  return (
    <DashboardLayout>
      <div className="space-y-8 animate-slide-in">
        <div>
          <h1 className="text-[28px] font-bold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            Übersicht deiner eBay Verkaufsaktivität
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Aktive Listings" value={stats?.activeListings ?? 0} icon={Package} accent />
          <StatCard label="Offene Orders" value={stats?.openOrders ?? 0} icon={ShoppingCart} />
          <StatCard
            label="Umsatz 30 Tage"
            value={`€${(stats?.revenue30Days ?? 0).toLocaleString("de-DE", { minimumFractionDigits: 2 })}`}
            icon={DollarSign}
          />
          <StatCard label="Pausierte Listings" value={stats?.pausedListings ?? 0} icon={Pause} />
        </div>

        {/* API Health */}
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="p-3 rounded-xl bg-success/10">
            <Activity className="w-5 h-5 text-success" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-foreground">System Status</p>
            <p className="text-[13px] text-success font-mono mt-0.5">
              Online · {stats?.totalOffers ?? 0} Offers · {stats?.totalOrders ?? 0} Orders
            </p>
          </div>
        </div>

        {/* Recent Listings */}
        <div className="glass-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
            <h2 className="text-[15px] font-semibold text-foreground">Neueste Listings</h2>
            <Link to="/listings" className="text-[13px] text-primary hover:text-primary/80 flex items-center gap-1 font-medium transition-colors">
              Alle anzeigen <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {recentListings.length === 0 ? (
            <div className="py-12 text-center text-[14px] text-muted-foreground">
              Noch keine Listings. Importiere Produkte, um loszulegen.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Status</th>
                    <th>Preis</th>
                    <th>Menge</th>
                    <th>eBay ID</th>
                  </tr>
                </thead>
                <tbody>
                  {recentListings.map((l) => (
                    <tr key={l.id}>
                      <td className="font-mono text-xs text-muted-foreground">{l.sku}</td>
                      <td>
                        <span className={`status-badge ${l.state === 'active' || l.state === 'published' ? 'status-active' : l.state === 'paused' ? 'status-paused' : l.state === 'error' ? 'status-error' : 'status-pending'}`}>
                          {l.state}
                        </span>
                      </td>
                      <td className="font-mono">€{(l.price ?? 0).toFixed(2)}</td>
                      <td className="font-mono">{l.quantity ?? 0}</td>
                      <td className="font-mono text-xs text-muted-foreground">{l.listing_id || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Orders */}
        <div className="glass-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
            <h2 className="text-[15px] font-semibold text-foreground">Neueste Orders</h2>
            <Link to="/orders" className="text-[13px] text-primary hover:text-primary/80 flex items-center gap-1 font-medium transition-colors">
              Alle anzeigen <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <div className="py-12 text-center text-[14px] text-muted-foreground">
              Noch keine Orders vorhanden.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Status</th>
                    <th>Gesamt</th>
                    <th>Datum</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((o) => (
                    <tr key={o.id}>
                      <td className="font-mono text-xs">{o.order_id}</td>
                      <td>
                        <span className={`status-badge ${o.order_status === 'delivered' ? 'status-active' : o.order_status === 'shipped' ? 'status-pending' : o.order_status === 'cancelled' ? 'status-error' : 'status-paused'}`}>
                          {o.order_status}
                        </span>
                      </td>
                      <td className="font-mono">€{(o.total_price ?? 0).toFixed(2)}</td>
                      <td className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString("de-DE")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Index;
