import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { fetchOrders } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Send, CheckCircle, Loader2, Plus, Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const OrdersPage = () => {
  const { sellerId } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [trackingDialog, setTrackingDialog] = useState<any>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("DHL");
  const [addingTracking, setAddingTracking] = useState(false);

  async function handlePushTracking(shipment: any) {
    if (!sellerId) return;
    setPushingId(shipment.id);
    try {
      const { data, error } = await supabase.functions.invoke("push-tracking", {
        body: { shipmentId: shipment.id, sellerId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Push fehlgeschlagen");
      toast.success(data.message);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (err: any) {
      toast.error(err.message || "Tracking-Push fehlgeschlagen");
    } finally {
      setPushingId(null);
    }
  }

  async function handleAddTracking(orderId: string) {
    if (!sellerId || !trackingNumber.trim()) return;
    setAddingTracking(true);
    try {
      const { error } = await supabase
        .from("shipments")
        .insert({
          order_id: orderId,
          seller_id: sellerId,
          tracking_number: trackingNumber.trim(),
          carrier,
        });
      if (error) throw error;
      toast.success("Tracking-Nummer hinzugefügt");
      setTrackingDialog(null);
      setTrackingNumber("");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Hinzufügen");
    } finally {
      setAddingTracking(false);
    }
  }

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders", sellerId],
    queryFn: () => fetchOrders(sellerId!),
    enabled: !!sellerId,
  });

  const filtered = orders.filter((o) => {
    const buyerEmail = (o.buyer_json as Record<string, Json> | null)?.email as string || "";
    const matchSearch =
      o.order_id.toLowerCase().includes(search.toLowerCase()) ||
      buyerEmail.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || o.order_status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div>
          <h1 className="text-[28px] font-bold text-foreground tracking-tight">Orders</h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            {orders.length} Orders · {orders.filter((o) => o.order_status === "pending").length} ausstehend
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Order ID suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border/60 rounded-xl text-[14px] text-foreground placeholder:text-muted-foreground transition-all duration-200"
            />
          </div>
          <div className="flex items-center gap-1 bg-card border border-border/60 rounded-xl p-1">
            {["all", "pending", "shipped", "delivered", "cancelled"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                  statusFilter === s
                    ? "bg-primary text-primary-foreground shadow-apple-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "Alle" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="glass-card overflow-hidden">
          {isLoading ? (
            <div className="py-16 text-center text-[14px] text-muted-foreground">Laden...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-[14px] text-muted-foreground">
              {orders.length === 0 ? "Noch keine Orders vorhanden." : "Keine Orders gefunden."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Buyer</th>
                    <th>Status</th>
                    <th>Gesamt</th>
                    <th>Tracking</th>
                    <th>Datum</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((order) => {
                    const buyerEmail = (order.buyer_json as Record<string, Json> | null)?.email as string || "—";
                    const shipment = (order as any).shipments?.[0];
                    return (
                      <tr key={order.id}>
                        <td className="font-mono text-xs">{order.order_id}</td>
                        <td className="text-[14px]">{buyerEmail}</td>
                        <td>
                          <span className={`status-badge ${order.order_status === 'delivered' ? 'status-active' : order.order_status === 'shipped' ? 'status-pending' : order.order_status === 'cancelled' ? 'status-error' : 'status-paused'}`}>
                            {order.order_status}
                          </span>
                        </td>
                        <td className="font-mono">€{(order.total_price ?? 0).toFixed(2)}</td>
                        <td>
                          {shipment ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs">{shipment.tracking_number}</span>
                              {shipment.tracking_pushed && <CheckCircle className="w-3.5 h-3.5 text-success" />}
                            </div>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString("de-DE")}</td>
                        <td>
                          {shipment && !shipment.tracking_pushed ? (
                            <button
                              onClick={() => handlePushTracking(shipment)}
                              disabled={pushingId === shipment.id}
                              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 transition-all duration-200 shadow-apple-sm disabled:opacity-50"
                            >
                              {pushingId === shipment.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                              {pushingId === shipment.id ? "Pushing..." : "Push"}
                            </button>
                          ) : !shipment && order.order_status === "pending" ? (
                            <button
                              onClick={() => setTrackingDialog(order)}
                              className="flex items-center gap-1.5 px-3.5 py-1.5 border border-border text-foreground text-xs font-semibold rounded-lg hover:bg-muted transition-all duration-200"
                            >
                              <Plus className="w-3 h-3" /> Tracking
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {/* Add Tracking Dialog */}
        <Dialog open={!!trackingDialog} onOpenChange={(open) => !open && setTrackingDialog(null)}>
          <DialogContent className="sm:max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-primary" />
                Tracking hinzufügen
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Tracking-Nummer</label>
                <Input
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="z.B. 123456789"
                  className="rounded-xl font-mono"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Versanddienstleister</label>
                <select
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  className="w-full px-3 py-2 bg-card border border-border/60 rounded-xl text-sm"
                >
                  <option value="DHL">DHL</option>
                  <option value="DPD">DPD</option>
                  <option value="Hermes">Hermes</option>
                  <option value="GLS">GLS</option>
                  <option value="UPS">UPS</option>
                  <option value="FedEx">FedEx</option>
                  <option value="Deutsche Post">Deutsche Post</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setTrackingDialog(null)} className="rounded-xl">
                  Abbrechen
                </Button>
                <Button
                  onClick={() => trackingDialog && handleAddTracking(trackingDialog.id)}
                  disabled={!trackingNumber.trim() || addingTracking}
                  className="rounded-xl"
                >
                  {addingTracking && <Loader2 className="w-4 h-4 animate-spin" />}
                  Hinzufügen & Push
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default OrdersPage;
