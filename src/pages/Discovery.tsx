import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Globe,
  Package,
  TrendingUp,
  AlertTriangle,
  Loader2,
  Play,
  RefreshCw,
  Truck,
  Star,
  Eye,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

export default function DiscoveryPage() {
  const { sellerId } = useAuth();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("autopilot_api_key") || "");

  const { data: status, isLoading } = useQuery({
    queryKey: ["discovery-status", sellerId],
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayISO = todayStart.toISOString();
      const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

      const [discoveredToday, euProducts, listingsToday, noSales, topProducts, totalDiscovered] =
        await Promise.all([
          supabase
            .from("source_products")
            .select("id", { count: "exact", head: true })
            .eq("seller_id", sellerId!)
            .eq("source_type", "cjdropshipping")
            .gte("created_at", todayISO),
          supabase
            .from("source_products")
            .select("id, title, price_source, price_ebay, attributes_json, images_json, created_at")
            .eq("seller_id", sellerId!)
            .eq("source_type", "cjdropshipping")
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("ebay_offers")
            .select("id", { count: "exact", head: true })
            .eq("seller_id", sellerId!)
            .gte("created_at", todayISO),
          supabase
            .from("ebay_offers")
            .select("id, sku, title, created_at, state")
            .eq("seller_id", sellerId!)
            .in("state", ["published", "active"])
            .lte("created_at", fourteenDaysAgo)
            .limit(20),
          supabase
            .from("source_products")
            .select("id, title, price_source, price_ebay, attributes_json")
            .eq("seller_id", sellerId!)
            .eq("source_type", "cjdropshipping")
            .not("price_ebay", "is", null)
            .order("price_ebay", { ascending: false })
            .limit(10),
          supabase
            .from("source_products")
            .select("id", { count: "exact", head: true })
            .eq("seller_id", sellerId!)
            .eq("source_type", "cjdropshipping"),
        ]);

      const euFiltered = (euProducts.data || []).filter((p: any) => {
        const attrs = p.attributes_json as any;
        return attrs?.warehouse && ["DE", "PL", "ES", "FR", "CZ", "NL", "IT", "BE"].includes(attrs.warehouse);
      });

      return {
        discoveredToday: discoveredToday.count || 0,
        totalDiscovered: totalDiscovered.count || 0,
        euWarehouseProducts: euFiltered.length,
        listingsCreatedToday: listingsToday.count || 0,
        recentProducts: euProducts.data || [],
        noSalesProducts: noSales.data || [],
        topProducts: topProducts.data || [],
      };
    },
    enabled: !!sellerId,
    refetchInterval: 30000,
  });

  const runDiscovery = useMutation({
    mutationFn: async () => {
      if (!apiKey) throw new Error("API Key benötigt");
      const res = await fetch(
        `https://${PROJECT_ID}.supabase.co/functions/v1/api/v1/discovery/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ maxProducts: 20 }),
        }
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      return res.json();
    },
    onSuccess: (data) => {
      toast.success("Discovery abgeschlossen", {
        description: `${data.discovered || 0} gefunden, ${data.imported || 0} importiert`,
      });
      queryClient.invalidateQueries({ queryKey: ["discovery-status"] });
    },
    onError: (err: Error) => toast.error("Discovery Fehler", { description: err.message }),
  });

  return (
    <DashboardLayout>
      <div className="space-y-8 animate-slide-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-bold text-foreground tracking-tight flex items-center gap-3">
              <Search className="w-7 h-7 text-primary" />
              Product Discovery
            </h1>
            <p className="text-[15px] text-muted-foreground mt-1">
              Automatische Produktfindung aus EU-Lagern von CJ Dropshipping
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["discovery-status"] })}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>

        {/* API Key + Run */}
        <div className="glass-card p-5">
          <label className="text-[13px] font-medium text-muted-foreground block mb-2">
            API Key für Discovery
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                localStorage.setItem("autopilot_api_key", e.target.value);
              }}
              placeholder="API Key eingeben..."
              className="flex-1 px-3 py-2 rounded-xl bg-muted border border-border text-sm font-mono"
            />
            <Button
              onClick={() => runDiscovery.mutate()}
              disabled={!apiKey || runDiscovery.isPending}
              className="gap-1.5"
            >
              {runDiscovery.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Discovery starten
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Entdeckt Heute"
            value={status?.discoveredToday ?? "—"}
            icon={Search}
            color="bg-primary/10 text-primary"
          />
          <StatCard
            label="EU Warehouse"
            value={status?.euWarehouseProducts ?? "—"}
            icon={Globe}
            color="bg-success/10 text-success"
          />
          <StatCard
            label="Listings Heute"
            value={status?.listingsCreatedToday ?? "—"}
            icon={Package}
            color="bg-warning/10 text-warning"
          />
          <StatCard
            label="Gesamt Entdeckt"
            value={status?.totalDiscovered ?? "—"}
            icon={Star}
            color="bg-muted text-muted-foreground"
          />
        </div>

        {/* Daily Progress */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[14px] font-semibold text-foreground">Tages-Fortschritt</p>
            <p className="text-[13px] font-mono text-muted-foreground">
              {status?.listingsCreatedToday ?? 0} / 100 Listings
            </p>
          </div>
          <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, ((status?.listingsCreatedToday ?? 0) / 100) * 100)}%` }}
            />
          </div>
        </div>

        {/* Top Products */}
        {(status?.topProducts?.length ?? 0) > 0 && (
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-success" />
              <h2 className="text-[15px] font-semibold text-foreground">Top Produkte</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produkt</th>
                    <th>EK</th>
                    <th>VK</th>
                    <th>Marge</th>
                    <th>Lager</th>
                  </tr>
                </thead>
                <tbody>
                  {(status?.topProducts || []).map((p: any) => {
                    const attrs = p.attributes_json as any;
                    const margin = p.price_ebay && p.price_source
                      ? Math.round(((p.price_ebay - p.price_source) / p.price_ebay) * 100)
                      : null;
                    return (
                      <tr key={p.id}>
                        <td className="max-w-[250px]">
                          <p className="text-sm font-medium text-foreground truncate">{p.title}</p>
                        </td>
                        <td className="font-mono text-sm">€{p.price_source?.toFixed(2)}</td>
                        <td className="font-mono text-sm font-semibold">€{p.price_ebay?.toFixed(2)}</td>
                        <td>
                          <span className={`font-mono text-sm font-semibold ${(margin ?? 0) >= 40 ? "text-success" : "text-warning"}`}>
                            {margin ?? "—"}%
                          </span>
                        </td>
                        <td>
                          {attrs?.warehouse && (
                            <span className="status-badge status-active inline-flex items-center gap-1">
                              <Truck className="w-3 h-3" />
                              {attrs.warehouse}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recently Discovered */}
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            <h2 className="text-[15px] font-semibold text-foreground">Kürzlich Entdeckt</h2>
          </div>
          {(status?.recentProducts?.length ?? 0) === 0 ? (
            <div className="py-12 text-center text-[14px] text-muted-foreground">
              Noch keine Produkte entdeckt. Starte die Discovery.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Bild</th>
                    <th>Produkt</th>
                    <th>EK</th>
                    <th>VK</th>
                    <th>Lager</th>
                    <th>Datum</th>
                  </tr>
                </thead>
                <tbody>
                  {(status?.recentProducts || []).slice(0, 15).map((p: any) => {
                    const attrs = p.attributes_json as any;
                    const images = (p.images_json as string[]) || [];
                    return (
                      <tr key={p.id}>
                        <td>
                          {images[0] ? (
                            <img src={images[0]} alt="" className="w-10 h-10 rounded-lg object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-muted" />
                          )}
                        </td>
                        <td className="max-w-[200px]">
                          <p className="text-sm font-medium text-foreground truncate">{p.title}</p>
                          {attrs?.eu_tags?.length > 0 && (
                            <div className="flex gap-1 mt-1">
                              {attrs.eu_tags.map((tag: string) => (
                                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success font-medium">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="font-mono text-sm">€{p.price_source?.toFixed(2) || "—"}</td>
                        <td className="font-mono text-sm font-semibold">€{p.price_ebay?.toFixed(2) || "—"}</td>
                        <td>
                          {attrs?.warehouse ? (
                            <span className="status-badge status-active text-xs">{attrs.warehouse}</span>
                          ) : "—"}
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString("de-DE")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Products without sales */}
        {(status?.noSalesProducts?.length ?? 0) > 0 && (
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <h2 className="text-[15px] font-semibold text-foreground">
                Ohne Verkäufe ({">"}14 Tage)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Titel</th>
                    <th>Status</th>
                    <th>Erstellt</th>
                    <th>Tage</th>
                  </tr>
                </thead>
                <tbody>
                  {(status?.noSalesProducts || []).map((p: any) => {
                    const days = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000);
                    return (
                      <tr key={p.id}>
                        <td className="font-mono text-xs text-muted-foreground">{p.sku}</td>
                        <td className="text-sm max-w-[200px] truncate">{p.title}</td>
                        <td>
                          <span className="status-badge status-paused">{p.state}</span>
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString("de-DE")}
                        </td>
                        <td>
                          <span className={`font-mono text-sm ${days > 21 ? "text-destructive" : "text-warning"}`}>
                            {days}d
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: any;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-[13px] text-muted-foreground font-medium">{label}</p>
          <p className="text-[28px] font-bold tracking-tight leading-none text-foreground">
            {value}
          </p>
        </div>
        <div className={`p-2.5 rounded-xl ${color}`}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
      </div>
    </div>
  );
}