import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Calculator, Save, Loader2, RefreshCw, Info } from "lucide-react";

interface PricingConfig {
  margin_percent: number;
  shipping_cost: number;
  ebay_fee_percent: number;
  paypal_fee_percent: number;
  paypal_fee_fixed: number;
  additional_costs: number;
  auto_sync_enabled: boolean;
  sync_interval_hours: number;
}

const DEFAULT_CONFIG: PricingConfig = {
  margin_percent: 20,
  shipping_cost: 4.99,
  ebay_fee_percent: 13,
  paypal_fee_percent: 2.49,
  paypal_fee_fixed: 0.35,
  additional_costs: 0,
  auto_sync_enabled: true,
  sync_interval_hours: 6,
};

function calculateEbayPrice(amazonPrice: number, config: PricingConfig): {
  ebayPrice: number;
  breakdown: { label: string; value: number }[];
} {
  const baseCost = amazonPrice;
  const shipping = config.shipping_cost;
  const additional = config.additional_costs;
  const totalCost = baseCost + shipping + additional;

  // eBay fee is on the final sale price, so we need to work backwards:
  // finalPrice = totalCost / (1 - ebayFee% - paypalFee%) + paypalFixed
  // Then add margin on top of totalCost
  const costWithMargin = totalCost * (1 + config.margin_percent / 100);

  // eBay + PayPal fees are on the final price, solve: price = costWithMargin + price * fees + paypalFixed
  // price * (1 - fees) = costWithMargin + paypalFixed
  // price = (costWithMargin + paypalFixed) / (1 - fees)
  const totalFeePercent = (config.ebay_fee_percent + config.paypal_fee_percent) / 100;
  const ebayPrice = (costWithMargin + config.paypal_fee_fixed) / (1 - totalFeePercent);

  const ebayFee = ebayPrice * (config.ebay_fee_percent / 100);
  const paypalFee = ebayPrice * (config.paypal_fee_percent / 100) + config.paypal_fee_fixed;
  const profit = ebayPrice - baseCost - shipping - additional - ebayFee - paypalFee;

  return {
    ebayPrice: Math.ceil(ebayPrice * 100) / 100,
    breakdown: [
      { label: "Amazon-Einkaufspreis", value: baseCost },
      { label: "Versandkosten", value: shipping },
      { label: "Sonstige Kosten", value: additional },
      { label: `eBay-Gebühr (${config.ebay_fee_percent}%)`, value: ebayFee },
      { label: `PayPal-Gebühr (${config.paypal_fee_percent}% + €${config.paypal_fee_fixed})`, value: paypalFee },
      { label: `Gewinn (${config.margin_percent}% Marge)`, value: profit },
    ],
  };
}

export function PricingSettings() {
  const { sellerId } = useAuth();
  const [config, setConfig] = useState<PricingConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Example calculation
  const examplePrice = 100;
  const example = calculateEbayPrice(examplePrice, config);

  useEffect(() => {
    if (!sellerId) return;
    (async () => {
      const { data } = await supabase
        .from("sellers")
        .select("pricing_settings")
        .eq("id", sellerId)
        .maybeSingle();
      if (data?.pricing_settings && typeof data.pricing_settings === "object") {
        setConfig({ ...DEFAULT_CONFIG, ...(data.pricing_settings as unknown as PricingConfig) });
      }
      setLoaded(true);
    })();
  }, [sellerId]);

  async function handleSave() {
    if (!sellerId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("sellers")
        .update({ pricing_settings: config as any })
        .eq("id", sellerId);
      if (error) throw error;
      toast.success("Preiseinstellungen gespeichert");
    } catch (err: any) {
      toast.error(err.message || "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncNow() {
    if (!sellerId) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-prices", {
        body: { sellerId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Sync fehlgeschlagen");
      toast.success(data.message || "Preise aktualisiert");
    } catch (err: any) {
      toast.error(err.message || "Preissync fehlgeschlagen");
    } finally {
      setSyncing(false);
    }
  }

  function updateField(field: keyof PricingConfig, value: number | boolean) {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }

  if (!loaded) return null;

  return (
    <div className="glass-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Calculator className="w-4 h-4 text-primary" />
          Preiskalkulation & Marge
        </h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleSyncNow} disabled={syncing}>
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {syncing ? "Synchronisiere..." : "Preise jetzt aktualisieren"}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Speichern
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Margin & Costs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Gewinnmarge (%)</label>
            <Input
              type="number"
              min={0}
              step={1}
              value={config.margin_percent}
              onChange={(e) => updateField("margin_percent", Number(e.target.value))}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Versandkosten (€)</label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={config.shipping_cost}
              onChange={(e) => updateField("shipping_cost", Number(e.target.value))}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Sonstige Kosten (€)</label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={config.additional_costs}
              onChange={(e) => updateField("additional_costs", Number(e.target.value))}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">eBay-Gebühr (%)</label>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={config.ebay_fee_percent}
              onChange={(e) => updateField("ebay_fee_percent", Number(e.target.value))}
              className="font-mono"
            />
            <p className="text-[10px] text-muted-foreground">Standard: 13% (Endwertgebühr)</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">PayPal/Zahlungsgebühr (%)</label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={config.paypal_fee_percent}
              onChange={(e) => updateField("paypal_fee_percent", Number(e.target.value))}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">PayPal Fixgebühr (€)</label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={config.paypal_fee_fixed}
              onChange={(e) => updateField("paypal_fee_fixed", Number(e.target.value))}
              className="font-mono"
            />
          </div>
        </div>

        {/* Auto Sync */}
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">Automatische Preisaktualisierung</p>
            <p className="text-xs text-muted-foreground">
              Amazon-Preise regelmäßig prüfen und eBay-Preise anpassen
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground">Alle</label>
              <Input
                type="number"
                min={1}
                max={24}
                value={config.sync_interval_hours}
                onChange={(e) => updateField("sync_interval_hours", Number(e.target.value))}
                className="w-16 font-mono text-center"
                disabled={!config.auto_sync_enabled}
              />
              <label className="text-xs text-muted-foreground">Std.</label>
            </div>
            <Switch
              checked={config.auto_sync_enabled}
              onCheckedChange={(v) => updateField("auto_sync_enabled", v)}
            />
          </div>
        </div>

        {/* Example Calculation */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">Beispielrechnung (Amazon €{examplePrice.toFixed(2)})</h3>
          </div>
          <div className="space-y-1.5">
            {example.breakdown.map((item) => (
              <div key={item.label} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{item.label}</span>
                <span className={`font-mono ${item.label.includes("Gewinn") ? "text-primary font-semibold" : "text-foreground"}`}>
                  €{item.value.toFixed(2)}
                </span>
              </div>
            ))}
            <div className="border-t border-border pt-1.5 mt-1.5 flex justify-between text-sm font-semibold">
              <span className="text-foreground">eBay-Verkaufspreis</span>
              <span className="text-primary font-mono">€{example.ebayPrice.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { calculateEbayPrice };
export type { PricingConfig };
