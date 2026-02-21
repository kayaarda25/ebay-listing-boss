import { DashboardLayout } from "@/components/DashboardLayout";
import { PricingSettings } from "@/components/PricingSettings";
import { useAuth } from "@/hooks/useAuth";
import { fetchSeller } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Link2, Shield, RefreshCw, LogOut } from "lucide-react";

const SettingsPage = () => {
  const { sellerId, user, signOut } = useAuth();

  const { data: seller } = useQuery({
    queryKey: ["seller", sellerId],
    queryFn: () => fetchSeller(sellerId!),
    enabled: !!sellerId,
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Settings</h1>
            <p className="text-sm text-muted-foreground mt-1">Seller-Verbindungen & Konfiguration</p>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Abmelden
          </button>
        </div>

        {/* Account Info */}
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold text-foreground mb-2">Account</h2>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
          {sellerId && <p className="text-xs font-mono text-muted-foreground mt-1">Seller ID: {sellerId}</p>}
        </div>

        {/* Seller Connection */}
        <div className="glass-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">eBay Seller Account</h2>
            <button className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:opacity-90 transition-opacity">
              <Link2 className="w-3 h-3" />
              eBay verbinden
            </button>
          </div>
          <div className="px-4 py-4">
            {seller?.ebay_user_id ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-success" />
                  <div>
                    <p className="text-sm font-medium text-foreground">@{seller.ebay_user_id}</p>
                    <p className="text-xs text-muted-foreground font-mono">{seller.marketplace}</p>
                  </div>
                </div>
                <button className="p-1.5 rounded-md hover:bg-muted transition-colors">
                  <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Noch kein eBay-Account verbunden. Klicke "eBay verbinden", um den OAuth-Flow zu starten.</p>
            )}
          </div>
        </div>

        {/* OAuth Scopes */}
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Benötigte OAuth Scopes</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(seller?.token_scopes || ["sell.inventory", "sell.fulfillment", "sell.account"]).map((scope) => (
              <span key={scope} className="px-3 py-1 bg-muted rounded-full text-xs font-mono text-muted-foreground">
                {scope}
              </span>
            ))}
          </div>
        </div>

        {/* Pricing Settings */}
        <PricingSettings />
      </div>
    </DashboardLayout>
  );
};

export default SettingsPage;
