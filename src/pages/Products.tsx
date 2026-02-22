import { DashboardLayout } from "@/components/DashboardLayout";
import { ImportDialog } from "@/components/ImportDialog";
import { ProductDetailDialog } from "@/components/ProductDetailDialog";
import { ProductFilters, applyProductFilters, EMPTY_FILTERS, type ProductFilterValues } from "@/components/ProductFilters";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, ExternalLink, Package, Star, ImageOff, Trash2, Loader2, MapPin, Clock, Truck, Weight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

async function fetchProducts(sellerId: string) {
  const { data } = await supabase
    .from("source_products")
    .select("*")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });
  return data || [];
}

const ProductsPage = () => {
  const { sellerId } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [filters, setFilters] = useState<ProductFilterValues>(EMPTY_FILTERS);

  async function handleDelete(product: any) {
    if (!sellerId) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-product", {
        body: { productId: product.id, sellerId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Löschen fehlgeschlagen");
      toast.success(data.message);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setSelectedProduct(null);
    } catch (err: any) {
      toast.error(err.message || "Löschen fehlgeschlagen");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", sellerId],
    queryFn: () => fetchProducts(sellerId!),
    enabled: !!sellerId,
  });

  const searchFiltered = products.filter((p) => {
    const term = search.toLowerCase();
    return p.title.toLowerCase().includes(term) || p.source_id.toLowerCase().includes(term);
  });
  const filtered = applyProductFilters(searchFiltered, filters);

  function getImages(p: any): string[] {
    if (Array.isArray(p.images_json)) return p.images_json;
    return [];
  }

  function getAttr(p: any, key: string) {
    if (p.attributes_json && typeof p.attributes_json === "object") {
      return (p.attributes_json as Record<string, any>)[key] ?? null;
    }
    return null;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-bold text-foreground tracking-tight">Produkte</h1>
            <p className="text-[15px] text-muted-foreground mt-1">
              {products.length} importierte Quellprodukte
            </p>
          </div>
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-[14px] font-semibold rounded-xl hover:bg-primary/90 transition-all duration-200 shadow-apple-sm"
          >
            <Plus className="w-4 h-4" />
            Import
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Titel oder ASIN suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border/60 rounded-xl text-[14px] text-foreground placeholder:text-muted-foreground transition-all duration-200"
            />
          </div>
        </div>

        <ProductFilters filters={filters} onFiltersChange={setFilters} products={searchFiltered} />

        {isLoading ? (
          <div className="py-16 text-center text-[14px] text-muted-foreground">Laden...</div>
        ) : filtered.length === 0 ? (
          <div className="glass-card py-16 text-center text-[14px] text-muted-foreground flex flex-col items-center gap-3">
            <Package className="w-12 h-12 text-muted-foreground/30" />
            {products.length === 0
              ? "Noch keine Produkte. Importiere Amazon- oder CJ-Produkte, um loszulegen."
              : "Keine Produkte gefunden."}
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((p) => {
              const images = getImages(p);
              const brand = getAttr(p, "brand");
              const rating = getAttr(p, "rating");
              const reviewCount = getAttr(p, "review_count");
              const availability = getAttr(p, "availability");
              const warehouse = getAttr(p, "warehouse");
              const shippingTime = getAttr(p, "shipping_time");
              const shippingCost = getAttr(p, "shipping_cost");
              const weight = getAttr(p, "weight") || getAttr(p, "packing_weight");
              const category = getAttr(p, "category");
              const material = getAttr(p, "material");

              return (
                <div
                  key={p.id}
                  className="glass-card p-4 flex gap-4 cursor-pointer hover:shadow-apple transition-all duration-300"
                  onClick={() => setSelectedProduct(p)}
                >
                  {/* Images */}
                  <div className="flex gap-1.5 flex-shrink-0">
                    {images.length > 0 ? (
                      images.slice(0, 4).map((img, i) => (
                        <div
                          key={i}
                          className={`rounded-xl border border-border/40 bg-muted overflow-hidden flex items-center justify-center ${
                            i === 0 ? "w-20 h-20" : "w-14 h-14"
                          }`}
                        >
                          <img src={img} alt={`${p.title} ${i + 1}`} className="w-full h-full object-contain" loading="lazy" />
                        </div>
                      ))
                    ) : (
                      <div className="w-20 h-20 rounded-xl border border-border/40 bg-muted flex items-center justify-center">
                        <ImageOff className="w-6 h-6 text-muted-foreground/30" />
                      </div>
                    )}
                    {images.length > 4 && (
                      <div className="w-14 h-14 rounded-xl border border-border/40 bg-muted flex items-center justify-center text-xs text-muted-foreground font-medium">
                        +{images.length - 4}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[14px] font-semibold text-foreground leading-snug line-clamp-2">
                          {p.title}
                        </h3>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground">{p.source_id}</span>
                          {brand && <span className="text-xs text-muted-foreground">· {brand}</span>}
                          {rating != null && (
                            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                              <Star className="w-3 h-3 fill-current text-primary" />
                              {rating}
                              {reviewCount != null && <span className="text-muted-foreground/50">({reviewCount})</span>}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          {p.price_source != null && (
                            <span className="text-xs text-muted-foreground font-mono block">
                              EK €{Number(p.price_source).toFixed(2)}
                            </span>
                          )}
                          {(p as any).price_ebay != null && (
                            <span className="text-xl font-bold text-primary font-mono">
                              €{Number((p as any).price_ebay).toFixed(2)}
                            </span>
                          )}
                          {(p as any).price_ebay == null && p.price_source != null && (
                            <span className="text-xl font-bold text-foreground font-mono">
                              €{Number(p.price_source).toFixed(2)}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}
                          className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
                          title="Produkt löschen"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {p.description && (
                      <p className="text-[13px] text-muted-foreground line-clamp-2 leading-relaxed">
                        {p.description}
                      </p>
                    )}

                    {/* Extra details row */}
                    <div className="flex items-center gap-3 flex-wrap pt-0.5">
                      {warehouse && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="w-3 h-3" /> {warehouse}
                        </span>
                      )}
                      {shippingTime && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" /> {shippingTime}{typeof shippingTime === "number" ? " Tage" : ""}
                        </span>
                      )}
                      {shippingCost != null && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Truck className="w-3 h-3" /> Versand €{Number(shippingCost).toFixed(2)}
                        </span>
                      )}
                      {weight && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Weight className="w-3 h-3" /> {weight}
                        </span>
                      )}
                      {category && (
                        <span className="text-xs text-muted-foreground/70">
                          {category}
                        </span>
                      )}
                      {material && (
                        <span className="text-xs text-muted-foreground/70">
                          {material}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      {availability && (
                        <span className={`text-xs font-medium ${
                          availability.toLowerCase().includes("auf lager") || availability.toLowerCase().includes("in stock")
                            ? "text-success" : "text-muted-foreground"
                        }`}>
                          {availability}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Bestand: {p.stock_source ?? "—"}
                      </span>
                      {p.source_type === "cjdropshipping" ? (
                        <a
                          href={`https://cjdropshipping.com/product/p-${p.source_id}.html`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:text-primary/80 inline-flex items-center gap-1 ml-auto font-medium transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          CJ <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <a
                          href={`https://www.amazon.de/dp/${p.source_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:text-primary/80 inline-flex items-center gap-1 ml-auto font-medium transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Amazon <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(p.created_at).toLocaleDateString("de-DE")}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <ImportDialog open={importOpen} onOpenChange={setImportOpen} onSuccess={() => queryClient.invalidateQueries({ queryKey: ["products"] })} />
        <ProductDetailDialog
          product={selectedProduct}
          open={!!selectedProduct}
          onOpenChange={(open) => !open && setSelectedProduct(null)}
          onUpdate={() => queryClient.invalidateQueries({ queryKey: ["products"] })}
          onDelete={(product) => { setSelectedProduct(null); setDeleteTarget(product); }}
        />

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent className="rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Produkt löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>{deleteTarget?.title}</strong> wird unwiderruflich gelöscht – inkl. aller verknüpften eBay-Listings, Inventory Items und gespeicherten Bilder.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting} className="rounded-xl">Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteTarget && handleDelete(deleteTarget)}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {deleting ? "Lösche..." : "Endgültig löschen"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
};

export default ProductsPage;
