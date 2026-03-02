import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
  ThumbsDown,
  ThumbsUp,
  ExternalLink,
  Loader2,
  Package,
  Euro,
  TrendingUp,
  SkipForward,
  Undo2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

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
}

const ProductSwipePage = () => {
  const { sellerId } = useAuth();
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swiping, setSwiping] = useState<"left" | "right" | null>(null);
  const [acting, setActing] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [imgIndex, setImgIndex] = useState(0);

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
          .select("title, description, images_json, price_source, source_type")
          .eq("seller_id", sellerId)
          .eq("source_id", o.sku)
          .maybeSingle();

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
        });
      }
      return enriched;
    },
    enabled: !!sellerId,
  });

  const current = drafts[currentIndex];

  const handleSkip = useCallback(() => {
    if (acting) return;
    setImgIndex(0);
    setCurrentIndex((i) => i + 1);
  }, [acting]);

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
        setCurrentIndex((i) => i + 1);
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
      setCurrentIndex((i) => Math.max(0, i - 1));
      setImgIndex(0);
      toast("Rückgängig gemacht", { icon: "↩️" });
      queryClient.invalidateQueries({ queryKey: ["draft-offers"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActing(false);
    }
  }, [history, acting, queryClient]);

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") handleSwipe("left");
      if (e.key === "ArrowRight") handleSwipe("right");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSwipe, handleSkip]);

  const margin =
    current?.price && current?.purchase_price
      ? (
          ((current.price - current.purchase_price) / current.price) *
          100
        ).toFixed(0)
      : null;

  const remainingCount = Math.max(0, drafts.length - currentIndex);

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
                        onClick={() =>
                          setImgIndex((i) =>
                            i > 0 ? i - 1 : current.images.length - 1
                          )
                        }
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-background/80 backdrop-blur-sm hover:bg-background transition-colors shadow-sm"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() =>
                          setImgIndex((i) =>
                            i < current.images.length - 1 ? i + 1 : 0
                          )
                        }
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
                    {currentIndex + 1} / {drafts.length}
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

                <div className="flex items-center gap-4">
                  {current.purchase_price != null && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Euro className="w-4 h-4" />
                      <span className="text-sm">
                        EK:{" "}
                        <span className="font-mono font-semibold">
                          €{current.purchase_price.toFixed(2)}
                        </span>
                      </span>
                    </div>
                  )}
                  {current.price != null && (
                    <div className="flex items-center gap-1.5 text-foreground">
                      <Euro className="w-4 h-4" />
                      <span className="text-sm font-semibold">
                        VK:{" "}
                        <span className="font-mono">
                          €{current.price.toFixed(2)}
                        </span>
                      </span>
                    </div>
                  )}
                  {margin && (
                    <div className="flex items-center gap-1 text-sm">
                      <TrendingUp className="w-3.5 h-3.5 text-[hsl(var(--success))]" />
                      <span className="font-semibold text-[hsl(var(--success))]">
                        {margin}% Marge
                      </span>
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
                  ← Ablehnen &nbsp;·&nbsp; → Genehmigen &nbsp;·&nbsp; ↓
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
