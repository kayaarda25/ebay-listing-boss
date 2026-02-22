import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { fetchOrders } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Send, CheckCircle, Loader2, Plus, Truck, RefreshCw, ChevronDown, ChevronUp, MapPin, Package } from "lucide-react";
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
  const [syncing, setSyncing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function handleSyncOrders() {
    if (!sellerId) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("ebay-sync-orders", {
        body: { sellerId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Sync fehlgeschlagen");
      toast.success(`Orders synchronisiert: ${data.message}`);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (err: any) {
      toast.error(err.message || "Order-Sync fehlgeschlagen");
    } finally {
      setSyncing(false);
    }
  }

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
    const buyer = o.buyer_json as Record<string, Json> | null;
    const buyerName = (buyer?.name as string) || "";
    const buyerUsername = (buyer?.username as string) || "";
    const items = (buyer?.items as any[]) || [];
    const itemTitles = items.map(i => i.title || "").join(" ");
    const searchText = `${o.order_id} ${buyerName} ${buyerUsername} ${itemTitles}`.toLowerCase();
    const matchSearch = searchText.includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || o.order_status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-bold text-foreground tracking-tight">Orders</h1>
            <p className="text-[15px] text-muted-foreground mt-1">
              {orders.length} Orders · {orders.filter((o) => o.order_status === "pending").length} ausstehend
            </p>
          </div>
          <button
            onClick={handleSyncOrders}
            disabled={syncing}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-[14px] font-semibold rounded-xl hover:bg-primary/90 transition-all duration-200 shadow-apple-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? "Synchronisiere..." : "Orders von eBay laden"}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Order ID, Käufer oder Produkt suchen..."
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
                    <th className="w-8"></th>
                    <th>Order ID</th>
                    <th>Produkt(e)</th>
                    <th>Käufer</th>
                    <th>Status</th>
                    <th>Gesamt</th>
                    <th>Tracking</th>
                    <th>Datum</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((order) => {
                    const buyer = order.buyer_json as Record<string, any> | null;
                    const buyerName = buyer?.name || buyer?.username || "—";
                    const buyerUsername = buyer?.username || "";
                    const address = buyer?.address as any;
                    const items = (buyer?.items as any[]) || [];
                    const shipment = (order as any).shipments?.[0];
                    const isExpanded = expandedId === order.id;

                    return (
                      <>
                        <tr
                          key={order.id}
                          className="cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : order.id)}
                        >
                          <td className="w-8 text-center">
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-muted-foreground inline" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-muted-foreground inline" />
                            )}
                          </td>
                          <td className="font-mono text-xs">{order.order_id}</td>
                          <td className="max-w-[200px]">
                            {items.length > 0 ? (
                              <div>
                                <p className="text-[13px] font-medium text-foreground truncate">
                                  {items[0].title || items[0].sku || "—"}
                                </p>
                                {items.length > 1 && (
                                  <p className="text-xs text-muted-foreground">
                                    +{items.length - 1} weitere
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="text-[14px]">
                            <div>{buyerName}</div>
                            {buyerUsername && buyerUsername !== buyerName && (
                              <div className="text-xs text-muted-foreground">{buyerUsername}</div>
                            )}
                          </td>
                          <td>
                            <span
                              className={`status-badge ${
                                order.order_status === "delivered"
                                  ? "status-active"
                                  : order.order_status === "shipped"
                                  ? "status-pending"
                                  : order.order_status === "cancelled"
                                  ? "status-error"
                                  : "status-paused"
                              }`}
                            >
                              {order.order_status}
                            </span>
                          </td>
                          <td className="font-mono font-semibold">€{(order.total_price ?? 0).toFixed(2)}</td>
                          <td>
                            {shipment ? (
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs">{shipment.tracking_number}</span>
                                {shipment.tracking_pushed && (
                                  <CheckCircle className="w-3.5 h-3.5 text-success" />
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="text-xs text-muted-foreground">
                            {new Date(order.created_at).toLocaleString("de-DE")}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {shipment && !shipment.tracking_pushed ? (
                              <button
                                onClick={() => handlePushTracking(shipment)}
                                disabled={pushingId === shipment.id}
                                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 transition-all duration-200 shadow-apple-sm disabled:opacity-50"
                              >
                                {pushingId === shipment.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Send className="w-3 h-3" />
                                )}
                                Push
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
                        {isExpanded && (
                          <tr key={`${order.id}-detail`}>
                            <td colSpan={9} className="!p-0">
                              <div className="bg-muted/30 border-t border-border/40 px-6 py-4 space-y-4">
                                {/* Artikel */}
                                {items.length > 0 && (
                                  <div>
                                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                      <Package className="w-3.5 h-3.5" /> Bestellte Artikel
                                    </h4>
                                    <div className="space-y-2">
                                      {items.map((item: any, idx: number) => (
                                        <div
                                          key={idx}
                                          className="flex items-center justify-between bg-card rounded-xl px-4 py-2.5 border border-border/40"
                                        >
                                          <div className="flex-1 min-w-0">
                                            <p className="text-[13px] font-medium text-foreground truncate">
                                              {item.title || "Unbekanntes Produkt"}
                                            </p>
                                            <div className="flex items-center gap-3 mt-0.5">
                                              {item.sku && (
                                                <span className="text-xs font-mono text-muted-foreground">
                                                  SKU: {item.sku}
                                                </span>
                                              )}
                                              {item.itemId && (
                                                <a
                                                  href={`https://www.ebay.de/itm/${item.itemId}`}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-xs text-primary hover:underline"
                                                >
                                                  eBay #{item.itemId}
                                                </a>
                                              )}
                                            </div>
                                          </div>
                                          <div className="text-right ml-4">
                                            <span className="text-[13px] font-mono font-semibold">
                                              €{Number(item.price || 0).toFixed(2)}
                                            </span>
                                            <span className="text-xs text-muted-foreground ml-2">
                                              × {item.quantity || 1}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Lieferadresse */}
                                {address && (address.street1 || address.city) && (
                                  <div>
                                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                      <MapPin className="w-3.5 h-3.5" /> Lieferadresse
                                    </h4>
                                    <div className="bg-card rounded-xl px-4 py-3 border border-border/40 text-[13px] text-foreground leading-relaxed">
                                      <p className="font-medium">{buyerName}</p>
                                      {address.street1 && <p>{address.street1}</p>}
                                      {address.street2 && <p>{address.street2}</p>}
                                      <p>
                                        {address.postalCode} {address.city}
                                      </p>
                                      {address.country && <p>{address.country}</p>}
                                      {address.phone && address.phone !== "Invalid Request" && (
                                        <p className="text-muted-foreground mt-1">Tel: {address.phone}</p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
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
