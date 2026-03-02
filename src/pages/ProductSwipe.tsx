import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  ThumbsDown,
  ThumbsUp,
  ExternalLink,
  Loader2,
  Package,
  TrendingUp,
  SkipForward,
  Undo2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface PriceBreakdown {
  purchase_price: number;
  shipping_cost: number;
  ebay_fee: number;
  promoted_fee: number;
  paypal_fee: number;
  total_costs: number;
  selling_price: number;
  net_profit: number;
}

interface DraftOffer {
  id: string;
  title: string | null;
  sku: string;
  price: number | null;
  source_url: string | null;
  purchase_price: number | null;
  images: string[];
  description: string | null;
  source_type: string | null;
  price_breakdown: PriceBreakdown | null;
  warehouse: string | null;
}

const ProductSwipePage = () => {
  const { sellerId } = useAuth();
  const queryClient = useQueryClient();
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [swiping, setSwiping] = useState<"left" | "right" | null>(null);
  const [acting, setActing] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [imgIndex, setImgIndex] = useState(0);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const priceInputRef = useRef<HTMLInputElement>(null);

  const { data: drafts = [], isLoading } = useQuery({
    queryKey: ["draft-offers", sellerId],
    queryFn: async () => {
      if (!sellerId) return [];
      const { data: offers, error } = await supabase
        .from("ebay_offers")
        .select("id, title, sku, price, source_url")
        .eq("seller_id", sellerId)
        .eq("state", "draft")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const enriched: DraftOffer[] = [];
      for (const o of offers || []) {
        const { data: sp } = await supabase
          .from("source_products")
          .select("title, description, images_json, price_source, source_type, attributes_json")
          .eq("seller_id", sellerId)
          .eq("source_id", o.sku)
          .maybeSingle();

        const attrs = sp?.attributes_json as any;

        let images: string[] = [];
        if (sp?.images_json) {
          try {
            images = Array.isArray(sp.images_json)
              ? (sp.images_json as string[])
              : JSON.parse(String(sp.images_json));
          } catch {
            images = [];
          }
        }

        enriched.push({
          id: o.id,
          title: o.title || sp?.title || null,
          sku: o.sku,
          price: o.price,
          source_url: o.source_url,
          purchase_price: sp?.price_source ?? null,
          images: images.slice(0, 5),
          description: sp?.description || null,
          source_type: sp?.source_type || null,
          price_breakdown: attrs?.price_breakdown || null,
          warehouse: attrs?.warehouse || null,
        });
      }
      return enriched;
    },
    enabled: !!sellerId,
  });

  // Find first draft not yet seen/acted on
  const current = drafts.find((d) => !seenIds.has(d.id));

  const handleSkip = useCallback(() => {
    if (acting || !current) return;
    setImgIndex(0);
    setSeenIds((s) => new Set(s).add(current.id));
  }, [acting, current]);

  const handleSwipe = useCallback(
    async (direction: "left" | "right") => {
      if (!current || acting) return;
      setSwiping(direction);
      setActing(true);

      try {
        if (direction === "right") {
          const { error } = await supabase
            .from("ebay_offers")
            .update({ state: "approved" })
            .eq("id", current.id);
          if (error) throw error;
          toast.success("Produkt genehmigt ✅");
        } else {
          const { error } = await supabase
            .from("ebay_offers")
            .delete()
            .eq("id", current.id);
          if (error) throw error;
          toast("Produkt gelöscht", { icon: "🗑️" });
        }
        setHistory((h) => [...h, current.id]);

        await new Promise((r) => setTimeout(r, 350));
        setSwiping(null);
        setImgIndex(0);
        setSeenIds((s) => new Set(s).add(current.id));
        queryClient.invalidateQueries({ queryKey: ["draft-offers"] });
        queryClient.invalidateQueries({ queryKey: ["listings"] });
      } catch (err: any) {
        toast.error(err.message || "Fehler");
        setSwiping(null);
      } finally {
        setActing(false);
      }
    },
    [current, acting, queryClient]
  );

  const handleUndo = useCallback(async () => {
    if (history.length === 0 || acting) return;
    setActing(true);
    const lastId = history[history.length - 1];
    try {
      const { error } = await supabase
        .from("ebay_offers")
        .update({ state: "draft" })
        .eq("id", lastId);
      if (error) throw error;
      setHistory((h) => h.slice(0, -1));
      setSeenIds((s) => { const ns = new Set(s); ns.delete(lastId); return ns; });
      setImgIndex(0);
      toast("Rückgängig gemacht", { icon: "↩️" });
      queryClient.invalidateQueries({ queryKey: ["draft-offers"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActing(false);
    }
  }, [history, acting, queryClient]);

  // Keyboard support — use distinct keys so arrow keys don't conflict with image nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "a" || e.key === "A") handleSwipe("left");
      if (e.key === "d" || e.key === "D") handleSwipe("right");
      if (e.key === "s" || e.key === "S" || e.key === "ArrowDown") {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSwipe, handleSkip]);

  // Calculate breakdown – use stored data or estimate from VK/EK
  const breakdown = (() => {
    const rawPb = current?.price_breakdown;
    if (rawPb) return rawPb;
    const vk = current?.price ?? 0;
    const ek = current?.purchase_price ?? 0;
    if (!vk) return null;
    const shippingEst = 3.0;
    const ebayFee = Math.round(vk * 0.13 * 100) / 100;
    const promotedFee = Math.round(vk * 0.05 * 100) / 100;
    const paypalFee = Math.round((vk * 0.0249 + 0.35) * 100) / 100;
    const totalCosts = Math.round((ek + shippingEst + ebayFee + promotedFee + paypalFee) * 100) / 100;
    const profit = Math.round((vk - totalCosts) * 100) / 100;
    return {
      purchase_price: ek,
      shipping_cost: shippingEst,
      ebay_fee: ebayFee,
      promoted_fee: promotedFee,
      paypal_fee: paypalFee,
      total_costs: totalCosts,
      selling_price: vk,
      net_profit: profit,
    } as PriceBreakdown;
  })();

  const remainingCount = drafts.filter((d) => !seenIds.has(d.id)).length;

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-bold text-foreground tracking-tight">
              Produkt-Prüfung
            </h1>
            <p className="text-[15px] text-muted-foreground mt-1">
              {remainingCount > 0
                ? `${remainingCount} Produkte warten auf deine Entscheidung`
                : "Alle Produkte geprüft 🎉"}
            </p>
          </div>
          {history.length > 0 && (
            <button
              onClick={handleUndo}
              disabled={acting}
              className="flex items-center gap-2 px-4 py-2.5 border border-border/60 text-foreground text-[14px] font-semibold rounded-xl hover:bg-muted transition-all duration-200 disabled:opacity-50"
            >
              <Undo2 className="w-4 h-4" />
              Rückgängig
            </button>
          )}
        </div>

        <div className="flex justify-center">
          {isLoading ? (
            <div className="py-24 text-center text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
              Lade Produkte...
            </div>
          ) : !current ? (
            <div className="glass-card p-16 text-center max-w-md">
              <Package className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Alles erledigt!
              </h2>
              <p className="text-muted-foreground text-[14px]">
                Keine weiteren Drafts zum Prüfen. Neue Produkte erscheinen
                hier, sobald der Autopilot welche findet.
              </p>
            </div>
          ) : (
            <div
              className={`glass-card max-w-lg w-full overflow-hidden transition-all duration-300 ${
                swiping === "left"
                  ? "-translate-x-[120%] -rotate-12 opacity-0"
                  : swiping === "right"
                  ? "translate-x-[120%] rotate-12 opacity-0"
                  : ""
              }`}
            >
              {/* Image */}
              {current.images.length > 0 ? (
                <div className="relative aspect-square bg-muted overflow-hidden">
                  <img
                    src={current.images[imgIndex] || current.images[0]}
                    alt={current.title || "Produkt"}
                    className="w-full h-full object-contain"
                  />
                  {current.images.length > 1 && (
                    <>
                       <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setImgIndex((i) =>
                            i > 0 ? i - 1 : current.images.length - 1
                          );
                        }}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-background/80 backdrop-blur-sm hover:bg-background transition-colors shadow-sm"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setImgIndex((i) =>
                            i < current.images.length - 1 ? i + 1 : 0
                          );
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-background/80 backdrop-blur-sm hover:bg-background transition-colors shadow-sm"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                        {current.images.map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setImgIndex(i)}
                            className={`w-2 h-2 rounded-full transition-all ${
                              i === imgIndex
                                ? "bg-primary scale-125"
                                : "bg-foreground/30"
                            }`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                  <div className="absolute top-3 right-3 bg-background/80 backdrop-blur-sm text-foreground text-xs font-semibold px-3 py-1 rounded-full">
                    {drafts.length - remainingCount + 1} / {drafts.length}
                  </div>
                </div>
              ) : (
                <div className="aspect-[4/3] bg-muted flex items-center justify-center">
                  <Package className="w-16 h-16 text-muted-foreground/30" />
                </div>
              )}

              {/* Info */}
              <div className="p-5 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground leading-tight line-clamp-2">
                    {current.title || "Kein Titel"}
                  </h2>
                  <p className="text-xs font-mono text-muted-foreground mt-1">
                    SKU: {current.sku}
                  </p>
                </div>

                {/* Price Breakdown */}
                <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-[13px]">
                  <div className="flex justify-between text-muted-foreground">
                    <span>EK (CJ)</span>
                    <span className="font-mono">{breakdown ? `€${breakdown.purchase_price.toFixed(2)}` : "–"}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Versand</span>
                    <span className="font-mono">{breakdown ? `€${breakdown.shipping_cost.toFixed(2)}` : "–"}{!current.price_breakdown && breakdown ? " *" : ""}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>eBay Gebühr (13%)</span>
                    <span className="font-mono">{breakdown ? `€${breakdown.ebay_fee.toFixed(2)}` : "–"}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Basis-Anzeige (5%)</span>
                    <span className="font-mono">{breakdown ? `€${breakdown.promoted_fee.toFixed(2)}` : "–"}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>PayPal (2.49% + €0.35)</span>
                    <span className="font-mono">{breakdown ? `€${breakdown.paypal_fee.toFixed(2)}` : "–"}</span>
                  </div>
                  <div className="border-t border-border/60 my-1" />
                  <div className="flex justify-between items-center font-semibold text-foreground">
                    <span>VK</span>
                    {editingPrice ? (
                      <input
                        ref={priceInputRef}
                        type="number"
                        step="0.01"
                        value={priceInput}
                        onChange={(e) => setPriceInput(e.target.value)}
                        onBlur={async () => {
                          const val = parseFloat(priceInput);
                          if (!isNaN(val) && val > 0 && current) {
                            await supabase.from("ebay_offers").update({ price: val }).eq("id", current.id);
                            queryClient.invalidateQueries({ queryKey: ["draft-offers"] });
                            toast.success(`VK auf €${val.toFixed(2)} geändert`);
                          }
                          setEditingPrice(false);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingPrice(false);
                        }}
                        className="w-24 text-right font-mono bg-background border border-border rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          setPriceInput(current.price?.toFixed(2) || "0");
                          setEditingPrice(true);
                          setTimeout(() => priceInputRef.current?.select(), 50);
                        }}
                        className="font-mono hover:text-primary transition-colors cursor-pointer underline decoration-dashed underline-offset-4"
                      >
                        {current.price != null ? `€${current.price.toFixed(2)}` : "–"}
                      </button>
                    )}
                  </div>
                  <div className={`flex justify-between font-bold ${breakdown && breakdown.net_profit > 0 ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                    <span>Profit</span>
                    <span className="font-mono">{breakdown ? `€${breakdown.net_profit.toFixed(2)}` : "–"}</span>
                  </div>
                  {current.warehouse && (
                    <div className="flex justify-between text-muted-foreground text-[11px] pt-1">
                      <span>Lager</span>
                      <span className="font-mono">{current.warehouse}</span>
                    </div>
                  )}
                </div>

                {current.source_url && (
                  <a
                    href={current.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Quelle ansehen ({current.source_type || "Link"})
                  </a>
                )}

                {/* Swipe buttons */}
                <div className="flex items-center justify-center gap-6 pt-3">
                  <button
                    onClick={() => handleSwipe("left")}
                    disabled={acting}
                    className="group flex items-center justify-center w-16 h-16 rounded-full border-2 border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground hover:border-destructive hover:scale-110 transition-all duration-200 disabled:opacity-50 shadow-sm"
                    title="Ablehnen"
                  >
                    <ThumbsDown className="w-7 h-7 group-hover:scale-110 transition-transform" />
                  </button>

                  <button
                    onClick={handleSkip}
                    disabled={acting}
                    className="flex items-center justify-center w-10 h-10 rounded-full border border-border/60 text-muted-foreground hover:bg-muted hover:scale-105 transition-all duration-200 disabled:opacity-50"
                    title="Überspringen"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleSwipe("right")}
                    disabled={acting}
                    className="group flex items-center justify-center w-16 h-16 rounded-full border-2 border-[hsl(var(--success))]/30 text-[hsl(var(--success))] hover:bg-[hsl(var(--success))] hover:text-[hsl(var(--success-foreground))] hover:border-[hsl(var(--success))] hover:scale-110 transition-all duration-200 disabled:opacity-50 shadow-sm"
                    title="Genehmigen"
                  >
                    <ThumbsUp className="w-7 h-7 group-hover:scale-110 transition-transform" />
                  </button>
                </div>

                <p className="text-center text-[11px] text-muted-foreground/60">
                  A = Ablehnen &nbsp;·&nbsp; D = Genehmigen &nbsp;·&nbsp; S =
                  Überspringen
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ProductSwipePage;
