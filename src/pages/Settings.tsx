import { DashboardLayout } from "@/components/DashboardLayout";
import { Zap, Link2, Shield, RefreshCw } from "lucide-react";

const SettingsPage = () => {
  const sellers = [
    { name: "TechStore DE", ebayUser: "techstore_de", marketplace: "EBAY_DE", status: "connected", lastRefresh: "2026-02-21 14:00" },
    { name: "GadgetWorld", ebayUser: "gadget_world_eu", marketplace: "EBAY_DE", status: "error", lastRefresh: "2026-02-21 12:30" },
    { name: "AudioPro", ebayUser: "audio_pro_shop", marketplace: "EBAY_DE", status: "connected", lastRefresh: "2026-02-21 13:45" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Seller-Verbindungen & Konfiguration</p>
        </div>

        {/* Seller Connections */}
        <div className="glass-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">eBay Seller Accounts</h2>
            <button className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:opacity-90 transition-opacity">
              <Link2 className="w-3 h-3" />
              Seller verbinden
            </button>
          </div>
          <div className="divide-y divide-border">
            {sellers.map((seller) => (
              <div key={seller.name} className="px-4 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${seller.status === "connected" ? "bg-success" : "bg-destructive animate-pulse-glow"}`} />
                  <div>
                    <p className="text-sm font-medium text-foreground">{seller.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      @{seller.ebayUser} · {seller.marketplace}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Token: {seller.lastRefresh}</span>
                  <button className="p-1.5 rounded-md hover:bg-muted transition-colors">
                    <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* OAuth Scopes */}
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">OAuth Scopes</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {["sell.inventory", "sell.fulfillment", "sell.account"].map((scope) => (
              <span key={scope} className="px-3 py-1 bg-muted rounded-full text-xs font-mono text-muted-foreground">
                {scope}
              </span>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default SettingsPage;
