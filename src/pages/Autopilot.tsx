import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Zap,
  RefreshCw,
  Package,
  Truck,
  MapPin,
  ShoppingCart,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Play,
  Activity,
  Search,
  TrendingUp,
  Power,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

async function callApi(path: string, method: string, token: string, body?: any) {
  const res = await fetch(
    `https://${PROJECT_ID}.supabase.co/functions/v1/api${path}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
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

function JobRow({ job }: { job: any }) {
  const stateIcon: Record<string, any> = {
    queued: <Clock className="w-3.5 h-3.5 text-muted-foreground" />,
    running: <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />,
    done: <CheckCircle2 className="w-3.5 h-3.5 text-success" />,
    failed: <XCircle className="w-3.5 h-3.5 text-destructive" />,
  };

  const stateClass: Record<string, string> = {
    queued: "status-pending",
    running: "status-pending",
    done: "status-active",
    failed: "status-error",
  };

  return (
    <tr>
      <td className="font-mono text-xs text-muted-foreground">{job.type}</td>
      <td>
        <span className={`status-badge ${stateClass[job.state] || "status-pending"} inline-flex items-center gap-1.5`}>
          {stateIcon[job.state]}
          {job.state}
        </span>
      </td>
      <td className="text-xs text-muted-foreground">
        {new Date(job.created_at).toLocaleString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
          day: "2-digit",
          month: "2-digit",
        })}
      </td>
      <td className="text-xs text-destructive max-w-[200px] truncate">
        {job.error || "—"}
      </td>
    </tr>
  );
}

export default function AutopilotPage() {
  const { sellerId } = useAuth();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");

  // Autopilot active state from seller settings
  const { data: sellerData } = useQuery({
    queryKey: ["seller-settings", sellerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("sellers")
        .select("pricing_settings")
        .eq("id", sellerId!)
        .maybeSingle();
      return data?.pricing_settings as any;
    },
    enabled: !!sellerId,
  });

  const autopilotActive = sellerData?.autopilot_active || false;

  const toggleAutopilot = useMutation({
    mutationFn: async (active: boolean) => {
      const { data: current } = await supabase
        .from("sellers")
        .select("pricing_settings")
        .eq("id", sellerId!)
        .maybeSingle();

      const settings = (current?.pricing_settings as any) || {};
      const { error } = await supabase
        .from("sellers")
        .update({
          pricing_settings: {
            ...settings,
            autopilot_active: active,
            autopilot_interval_min: 5,
            autopilot_workflows: ["order_sync", "fulfillment", "tracking", "listings", "discovery", "optimize"],
            ...(active ? { autopilot_started_at: new Date().toISOString() } : {}),
          },
        })
        .eq("id", sellerId!);
      if (error) throw error;
      return active;
    },
    onSuccess: (active) => {
      toast.success(active ? "Autopilot aktiviert" : "Autopilot deaktiviert", {
        description: active
          ? "Alle Workflows laufen automatisch alle 5 Minuten"
          : "Automatische Ausführung gestoppt",
      });
      queryClient.invalidateQueries({ queryKey: ["seller-settings"] });
    },
    onError: (err: Error) => toast.error("Fehler", { description: err.message }),
  });

  // Fetch autopilot status via Supabase directly (no API key needed for dashboard)
  const { data: status, isLoading } = useQuery({
    queryKey: ["autopilot-status", sellerId],
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayISO = todayStart.toISOString();

      const [awaiting, fulfilledToday, listingsToday, recentJobs, totalListings, totalOrders] =
        await Promise.all([
          supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("seller_id", sellerId!)
            .eq("needs_fulfillment", true)
            .in("order_status", ["pending", "processing"]),
          supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("seller_id", sellerId!)
            .eq("order_status", "shipped")
            .gte("updated_at", todayISO),
          supabase
            .from("ebay_offers")
            .select("id", { count: "exact", head: true })
            .eq("seller_id", sellerId!)
            .gte("created_at", todayISO),
          supabase
            .from("jobs")
            .select("id, type, state, error, created_at, updated_at")
            .eq("seller_id", sellerId!)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("ebay_offers")
            .select("id", { count: "exact", head: true })
            .eq("seller_id", sellerId!)
            .in("state", ["published", "active"]),
          supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("seller_id", sellerId!),
        ]);

      return {
        ordersAwaitingFulfillment: awaiting.count || 0,
        ordersFulfilledToday: fulfilledToday.count || 0,
        listingsCreatedToday: listingsToday.count || 0,
        totalActiveListings: totalListings.count || 0,
        totalOrders: totalOrders.count || 0,
        recentJobs: recentJobs.data || [],
      };
    },
    enabled: !!sellerId,
    refetchInterval: 15000,
  });

  // Load API key from localStorage
  useState(() => {
    const saved = localStorage.getItem("autopilot_api_key");
    if (saved) setApiKey(saved);
  });

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem("autopilot_api_key", key);
  };

  const runAutopilot = useMutation({
    mutationFn: async (workflows?: string[]) => {
      if (!apiKey) throw new Error("API Key benötigt");
      return callApi("/v1/autopilot/run", "POST", apiKey, {
        workflows: workflows || ["order_sync", "fulfillment", "tracking", "listings", "discovery", "optimize"],
      });
    },
    onSuccess: (data) => {
      toast.success("Autopilot durchgelaufen", {
        description: `Workflows: ${Object.keys(data.autopilot?.workflows || {}).join(", ")}`,
      });
      queryClient.invalidateQueries({ queryKey: ["autopilot-status"] });
    },
    onError: (err: Error) => {
      toast.error("Autopilot Fehler", { description: err.message });
    },
  });

  const runningJobs = (status?.recentJobs || []).filter(
    (j: any) => j.state === "running" || j.state === "queued"
  ).length;
  const failedJobs = (status?.recentJobs || []).filter(
    (j: any) => j.state === "failed"
  ).length;

  return (
    <DashboardLayout>
      <div className="space-y-8 animate-slide-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-bold text-foreground tracking-tight flex items-center gap-3">
              <Zap className="w-7 h-7 text-primary" />
              Autopilot
            </h1>
            <p className="text-[15px] text-muted-foreground mt-1">
              Vollautomatische Steuerung deines eBay Dropshipping Stores
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["autopilot-status"] })}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Autopilot Toggle */}
        <div className={`glass-card p-5 border-2 transition-colors ${autopilotActive ? "border-success/50 bg-success/5" : "border-border"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${autopilotActive ? "bg-success/20" : "bg-muted"}`}>
                <Power className={`w-5 h-5 ${autopilotActive ? "text-success" : "text-muted-foreground"}`} />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-foreground">
                  Autopilot {autopilotActive ? "Aktiv" : "Inaktiv"}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {autopilotActive
                    ? "Alle Workflows laufen automatisch alle 5 Minuten"
                    : "Aktivieren für kontinuierliche Automatisierung"}
                </p>
              </div>
            </div>
            <Switch
              checked={autopilotActive}
              onCheckedChange={(checked) => toggleAutopilot.mutate(checked)}
              disabled={toggleAutopilot.isPending}
            />
          </div>
        </div>

        {/* API Key Input */}
        <div className="glass-card p-5">
          <label className="text-[13px] font-medium text-muted-foreground block mb-2">
            API Key für Autopilot
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => saveApiKey(e.target.value)}
              placeholder="API Key eingeben..."
              className="flex-1 px-3 py-2 rounded-xl bg-muted border border-border text-sm font-mono"
            />
            <Button
              onClick={() => runAutopilot.mutate(undefined)}
              disabled={!apiKey || runAutopilot.isPending}
              className="gap-1.5"
            >
              {runAutopilot.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Alle Workflows starten
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Awaiting Fulfillment"
            value={status?.ordersAwaitingFulfillment ?? "—"}
            icon={ShoppingCart}
            color="bg-warning/10 text-warning"
          />
          <StatCard
            label="Fulfilled Heute"
            value={status?.ordersFulfilledToday ?? "—"}
            icon={Truck}
            color="bg-success/10 text-success"
          />
          <StatCard
            label="Listings Heute"
            value={status?.listingsCreatedToday ?? "—"}
            icon={Package}
            color="bg-primary/10 text-primary"
          />
          <StatCard
            label="Aktive Listings"
            value={status?.totalActiveListings ?? "—"}
            icon={Activity}
            color="bg-muted text-muted-foreground"
          />
        </div>

        {/* Workflow Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { id: "order_sync", label: "Orders Syncen", icon: RefreshCw, desc: "eBay Orders importieren" },
            { id: "fulfillment", label: "Fulfillment", icon: Truck, desc: "CJ Orders erstellen" },
            { id: "tracking", label: "Tracking Sync", icon: MapPin, desc: "Tracking → eBay pushen" },
            { id: "listings", label: "Listings erstellen", icon: Package, desc: "Neue Listings publizieren" },
            { id: "discovery", label: "Discovery", icon: Search, desc: "Neue Produkte suchen" },
            { id: "optimize", label: "Optimierung", icon: TrendingUp, desc: "Stale Listings deaktivieren" },
          ].map((wf) => (
            <button
              key={wf.id}
              onClick={() => runAutopilot.mutate([wf.id])}
              disabled={!apiKey || runAutopilot.isPending}
              className="glass-card p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50 group"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <wf.icon className="w-4 h-4 text-primary" />
                </div>
                <p className="text-[14px] font-semibold text-foreground">{wf.label}</p>
              </div>
              <p className="text-[12px] text-muted-foreground">{wf.desc}</p>
            </button>
          ))}
        </div>

        {/* System Status */}
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="p-3 rounded-xl bg-success/10">
            <Activity className="w-5 h-5 text-success" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-foreground">System Status</p>
            <p className="text-[13px] text-success font-mono mt-0.5">
              Online · {status?.totalActiveListings ?? 0} Listings · {status?.totalOrders ?? 0} Orders
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-mono text-muted-foreground">{runningJobs} laufend</span>
            </div>
            {failedJobs > 0 && (
              <div className="flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5 text-destructive" />
                <span className="font-mono text-destructive">{failedJobs} fehlgeschlagen</span>
              </div>
            )}
          </div>
        </div>

        {/* Recent Jobs */}
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/60">
            <h2 className="text-[15px] font-semibold text-foreground">Letzte Jobs</h2>
          </div>
          {(status?.recentJobs || []).length === 0 ? (
            <div className="py-12 text-center text-[14px] text-muted-foreground">
              Noch keine Jobs vorhanden.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Typ</th>
                    <th>Status</th>
                    <th>Erstellt</th>
                    <th>Fehler</th>
                  </tr>
                </thead>
                <tbody>
                  {(status?.recentJobs || []).map((job: any) => (
                    <JobRow key={job.id} job={job} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}