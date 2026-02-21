import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { mockOrders } from "@/lib/mock-data";
import { Search, Send, CheckCircle } from "lucide-react";
import { useState } from "react";

const OrdersPage = () => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = mockOrders.filter((o) => {
    const matchSearch =
      o.orderId.toLowerCase().includes(search.toLowerCase()) ||
      o.buyer.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mockOrders.length} Orders · {mockOrders.filter((o) => o.status === "pending").length} ausstehend
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Order ID oder Buyer suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-1 bg-card border border-border rounded-md p-0.5">
            {["all", "pending", "shipped", "delivered", "cancelled"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "Alle" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="glass-card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Buyer</th>
                <th>Seller</th>
                <th>Status</th>
                <th>Gesamt</th>
                <th>Items</th>
                <th>Tracking</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.id}>
                  <td className="font-mono text-xs">{order.orderId}</td>
                  <td className="text-sm">{order.buyer}</td>
                  <td className="text-xs text-muted-foreground">{order.seller}</td>
                  <td><StatusBadge status={order.status} /></td>
                  <td className="font-mono">€{order.total.toFixed(2)}</td>
                  <td className="font-mono text-center">{order.items}</td>
                  <td>
                    {order.trackingNumber ? (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs">{order.trackingNumber}</span>
                        {order.trackingPushed && (
                          <CheckCircle className="w-3.5 h-3.5 text-success" />
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td>
                    {order.trackingNumber && !order.trackingPushed ? (
                      <button className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:opacity-90 transition-opacity">
                        <Send className="w-3 h-3" />
                        Push
                      </button>
                    ) : order.status === "pending" ? (
                      <span className="text-xs text-muted-foreground">Warte auf Tracking</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default OrdersPage;
