import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Search, Package, ImageOff, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface CreateListingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateListingDialog({ open, onOpenChange, onSuccess }: CreateListingDialogProps) {
  const { sellerId } = useAuth();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<string | null>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products-for-listing", sellerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("source_products")
        .select("id, title, source_id, price_source, price_ebay, images_json")
        .eq("seller_id", sellerId!)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!sellerId && open,
  });

  // Get existing listings to show which products already have one
  const { data: existingSkus = [] } = useQuery({
    queryKey: ["existing-listing-skus", sellerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("ebay_offers")
        .select("sku")
        .eq("seller_id", sellerId!);
      return (data || []).map((o) => o.sku);
    },
    enabled: !!sellerId && open,
  });

  const filtered = products.filter((p) => {
    const term = search.toLowerCase();
    return p.title.toLowerCase().includes(term) || p.source_id.toLowerCase().includes(term);
  });

  async function handleCreate(product: any) {
    if (!sellerId) return;
    setCreating(product.id);
    try {
      const sku = product.source_id;
      const price = product.price_ebay ?? product.price_source ?? 0;

      const { error } = await supabase.from("ebay_offers").insert({
        seller_id: sellerId,
        sku,
        price,
        quantity: product.stock_source ?? 1,
        state: "draft",
      });

      if (error) throw error;
      toast.success(`Listing für "${product.title}" als Draft erstellt`);
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Listing erstellen fehlgeschlagen");
    } finally {
      setCreating(null);
    }
  }

  function getFirstImage(p: any): string | null {
    if (Array.isArray(p.images_json) && p.images_json.length > 0) return p.images_json[0];
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Listing erstellen</DialogTitle>
          <p className="text-sm text-muted-foreground">Wähle ein Produkt, um ein eBay-Listing (Draft) zu erstellen.</p>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Produkt suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-muted border border-border/60 rounded-xl text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="overflow-y-auto flex-1 space-y-1.5 -mx-1 px-1">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <Package className="w-8 h-8 text-muted-foreground/30" />
              Keine Produkte gefunden.
            </div>
          ) : (
            filtered.map((p) => {
              const img = getFirstImage(p);
              const hasListing = existingSkus.includes(p.source_id);

              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border border-border/40 transition-all duration-200 ${
                    hasListing ? "opacity-50" : "hover:bg-muted/50 cursor-pointer"
                  }`}
                  onClick={() => !hasListing && !creating && handleCreate(p)}
                >
                  <div className="w-10 h-10 rounded-lg border border-border/40 bg-muted overflow-hidden flex items-center justify-center flex-shrink-0">
                    {img ? (
                      <img src={img} alt="" className="w-full h-full object-contain" />
                    ) : (
                      <ImageOff className="w-4 h-4 text-muted-foreground/30" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground line-clamp-1">{p.title}</p>
                    <p className="text-xs text-muted-foreground font-mono">{p.source_id}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {hasListing ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Check className="w-3 h-3" /> Listing vorhanden
                      </span>
                    ) : (
                      <span className="text-sm font-mono font-semibold text-foreground">
                        €{(p.price_ebay ?? p.price_source ?? 0).toFixed(2)}
                      </span>
                    )}
                  </div>
                  {creating === p.id && (
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
