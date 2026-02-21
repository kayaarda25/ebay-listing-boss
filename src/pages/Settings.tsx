import { DashboardLayout } from "@/components/DashboardLayout";
import { PricingSettings } from "@/components/PricingSettings";
import { useAuth } from "@/hooks/useAuth";
import { fetchSeller } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Shield, RefreshCw, LogOut, ShoppingCart, Eye, EyeOff, Loader2, Check } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const SettingsPage = () => {
  const { sellerId, user, signOut } = useAuth();
  const queryClient = useQueryClient();

  const { data: seller } = useQuery({
    queryKey: ["seller", sellerId],
    queryFn: () => fetchSeller(sellerId!),
    enabled: !!sellerId,
  });

  // Amazon credentials state
  const [amazonEmail, setAmazonEmail] = useState("");
  const [amazonPassword, setAmazonPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [savingAmazon, setSavingAmazon] = useState(false);

  useEffect(() => {
    if (seller) {
      setAmazonEmail((seller as any).amazon_email || "");
    }
  }, [seller]);

  async function handleSaveAmazon() {
    if (!sellerId || !amazonEmail.trim()) return;
    setSavingAmazon(true);
    try {
      const updateData: Record<string, string> = { amazon_email: amazonEmail.trim() };
      if (amazonPassword.trim()) {
        updateData.amazon_password_enc = amazonPassword.trim();
      }
      const { error } = await supabase
        .from("sellers")
        .update(updateData)
        .eq("id", sellerId);
      if (error) throw error;
      toast.success("Amazon-Zugangsdaten gespeichert");
      setAmazonPassword("");
      queryClient.invalidateQueries({ queryKey: ["seller"] });
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Speichern");
    } finally {
      setSavingAmazon(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-bold text-foreground tracking-tight">Settings</h1>
            <p className="text-[15px] text-muted-foreground mt-1">Seller-Verbindungen & Konfiguration</p>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-2 px-4 py-2 text-[14px] text-muted-foreground hover:text-foreground border border-border/60 rounded-xl hover:bg-muted transition-all duration-200"
          >
            <LogOut className="w-4 h-4" />
            Abmelden
          </button>
        </div>

        {/* Account Info */}
        <div className="glass-card p-5">
          <h2 className="text-[15px] font-semibold text-foreground mb-2">Account</h2>
          <p className="text-[14px] text-muted-foreground">{user?.email}</p>
          {sellerId && <p className="text-xs font-mono text-muted-foreground mt-1">Seller ID: {sellerId}</p>}
        </div>

        {/* Amazon Credentials */}
        <div className="glass-card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border/60">
            <ShoppingCart className="w-4 h-4 text-primary" />
            <h2 className="text-[15px] font-semibold text-foreground">Amazon Zugangsdaten</h2>
          </div>
          <div className="px-5 py-4 space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Deine Amazon-Login-Daten werden für automatische Bestellungen (Auto-Fulfillment) verwendet.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Amazon E-Mail</label>
              <Input
                type="email"
                value={amazonEmail}
                onChange={(e) => setAmazonEmail(e.target.value)}
                placeholder="amazon@example.com"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Passwort {(seller as any)?.amazon_password_enc ? "(bereits hinterlegt)" : ""}
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={amazonPassword}
                  onChange={(e) => setAmazonPassword(e.target.value)}
                  placeholder={
                    (seller as any)?.amazon_password_enc
                      ? "••••••••  (neues Passwort eingeben zum Ändern)"
                      : "Amazon Passwort"
                  }
                  className="rounded-xl pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={handleSaveAmazon}
                disabled={!amazonEmail.trim() || savingAmazon}
                className="rounded-xl"
              >
                {savingAmazon ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Speichern
              </Button>
              {(seller as any)?.amazon_email && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-success" />
                  Zugangsdaten hinterlegt
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Seller Connection */}
        <div className="glass-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
            <h2 className="text-[15px] font-semibold text-foreground">eBay Seller Account</h2>
            <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-[13px] font-semibold rounded-xl hover:bg-primary/90 transition-all duration-200 shadow-apple-sm">
              <Link2 className="w-3.5 h-3.5" />
              eBay verbinden
            </button>
          </div>
          <div className="px-5 py-4">
            {seller?.ebay_user_id ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-success" />
                  <div>
                    <p className="text-[14px] font-semibold text-foreground">@{seller.ebay_user_id}</p>
                    <p className="text-xs text-muted-foreground font-mono">{seller.marketplace}</p>
                  </div>
                </div>
                <button className="p-2 rounded-xl hover:bg-muted transition-all duration-200">
                  <RefreshCw className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <p className="text-[14px] text-muted-foreground">Noch kein eBay-Account verbunden. Klicke "eBay verbinden", um den OAuth-Flow zu starten.</p>
            )}
          </div>
        </div>

        {/* OAuth Scopes */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-primary" />
            <h2 className="text-[15px] font-semibold text-foreground">Benötigte OAuth Scopes</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(seller?.token_scopes || ["sell.inventory", "sell.fulfillment", "sell.account"]).map((scope) => (
              <span key={scope} className="px-3 py-1.5 bg-muted rounded-lg text-xs font-mono text-muted-foreground">
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
