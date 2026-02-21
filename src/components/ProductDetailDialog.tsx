import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Star, ImageOff, Sparkles, Loader2, Copy, Check, Trash2, Save, Tag } from "lucide-react";
import { VariantManager, type VariantGroup } from "@/components/VariantManager";
import { useAuth } from "@/hooks/useAuth";

interface ProductDetailDialogProps {
  product: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
  onDelete?: (product: any) => void;
}

export function ProductDetailDialog({ product, open, onOpenChange, onUpdate, onDelete }: ProductDetailDialogProps) {
  const { sellerId } = useAuth();
  const [optimizing, setOptimizing] = useState(false);
  const [optimizedTitle, setOptimizedTitle] = useState("");
  const [optimizedDesc, setOptimizedDesc] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [variants, setVariants] = useState<VariantGroup[]>([]);
  const [variantsLoaded, setVariantsLoaded] = useState(false);
  const [savingVariants, setSavingVariants] = useState(false);

  // Load variants when product changes
  if (product && !variantsLoaded) {
    const v = Array.isArray(product.variants_json) ? product.variants_json as VariantGroup[] : [];
    setVariants(v);
    setVariantsLoaded(true);
  }
  if (!product && variantsLoaded) {
    setVariantsLoaded(false);
  }

  async function handleSaveVariants() {
    if (!product) return;
    setSavingVariants(true);
    try {
      const { error } = await supabase
        .from("source_products")
        .update({ variants_json: variants as any })
        .eq("id", product.id);
      if (error) throw error;
      toast.success("Varianten gespeichert");
      onUpdate?.();
    } catch (err: any) {
      toast.error(err.message || "Speichern fehlgeschlagen");
    } finally {
      setSavingVariants(false);
    }
  }

  if (!product) return null;

  const images: string[] = Array.isArray(product.images_json) ? product.images_json : [];
  const attrs = product.attributes_json && typeof product.attributes_json === "object"
    ? product.attributes_json as Record<string, any>
    : {};

  // Mock eBay listing URL
  const ebayMockUrl = `https://www.ebay.de/itm/${product.source_id}`;

  async function handleOptimize() {
    setOptimizing(true);
    try {
      const { data, error } = await supabase.functions.invoke("optimize-listing", {
        body: {
          title: product.title,
          description: product.description,
          brand: attrs.brand,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Optimierung fehlgeschlagen");

      setOptimizedTitle(data.title);
      setOptimizedDesc(data.description);
      toast.success("Text wurde mit AI optimiert!");
    } catch (err: any) {
      console.error("Optimize error:", err);
      toast.error(err.message || "AI-Optimierung fehlgeschlagen");
    } finally {
      setOptimizing(false);
    }
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopied(field);
    toast.success("In Zwischenablage kopiert");
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg leading-snug pr-8">{product.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* All Images */}
          {images.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {images.map((img, i) => (
                <div
                  key={i}
                  className="w-28 h-28 rounded-lg border border-border bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center"
                >
                  <img src={img} alt={`${product.title} ${i + 1}`} className="w-full h-full object-contain" loading="lazy" />
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full h-32 rounded-lg border border-border bg-muted flex items-center justify-center">
              <ImageOff className="w-8 h-8 text-muted-foreground/40" />
            </div>
          )}

          {/* Product Info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">ASIN:</span>
              <span className="ml-2 font-mono">{product.source_id}</span>
            </div>
            {attrs.brand && (
              <div>
                <span className="text-muted-foreground">Marke:</span>
                <span className="ml-2">{attrs.brand}</span>
              </div>
            )}
            {product.price_source != null && (
              <div>
                <span className="text-muted-foreground">Preis:</span>
                <span className="ml-2 font-semibold font-mono">€{Number(product.price_source).toFixed(2)}</span>
              </div>
            )}
            {attrs.rating != null && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Bewertung:</span>
                <Star className="w-3.5 h-3.5 fill-current text-primary ml-1" />
                <span>{attrs.rating}</span>
                {attrs.review_count != null && (
                  <span className="text-muted-foreground">({attrs.review_count})</span>
                )}
              </div>
            )}
            {attrs.availability && (
              <div>
                <span className="text-muted-foreground">Verfügbarkeit:</span>
                <span className={`ml-2 font-medium ${
                  attrs.availability.toLowerCase().includes("auf lager") || attrs.availability.toLowerCase().includes("in stock")
                    ? "text-primary" : "text-muted-foreground"
                }`}>
                  {attrs.availability}
                </span>
              </div>
            )}
          </div>

          {/* Description */}
          {product.description && (
            <div>
              <h4 className="text-sm font-medium text-foreground mb-1">Beschreibung</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>
            </div>
          )}

          {/* Variants */}
          <div className="border border-border rounded-lg p-4 space-y-3 bg-card">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Tag className="w-4 h-4 text-primary" />
                Varianten
              </h4>
              {variants.length > 0 && (
                <Button size="sm" onClick={handleSaveVariants} disabled={savingVariants} className="rounded-xl">
                  {savingVariants ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Speichern
                </Button>
              )}
            </div>
            <VariantManager variants={variants} onChange={setVariants} />
          </div>

          {/* AI Optimization */}
          <div className="border border-border rounded-lg p-4 space-y-3 bg-card">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                eBay-Listing optimieren
              </h4>
              <Button size="sm" onClick={handleOptimize} disabled={optimizing}>
                {optimizing && <Loader2 className="w-4 h-4 animate-spin" />}
                {optimizing ? "Optimiere..." : "Mit AI optimieren"}
              </Button>
            </div>

            {optimizedTitle && (
              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-muted-foreground">Optimierter Titel</label>
                    <button
                      onClick={() => copyToClipboard(optimizedTitle, "title")}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      {copied === "title" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied === "title" ? "Kopiert" : "Kopieren"}
                    </button>
                  </div>
                  <div className="p-2 bg-muted rounded-md text-sm font-medium">{optimizedTitle}</div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-muted-foreground">Optimierte Beschreibung</label>
                    <button
                      onClick={() => copyToClipboard(optimizedDesc, "desc")}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      {copied === "desc" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied === "desc" ? "Kopiert" : "Kopieren"}
                    </button>
                  </div>
                  <Textarea value={optimizedDesc} readOnly rows={6} className="text-sm bg-muted" />
                </div>
              </div>
            )}
          </div>

          {/* eBay Mock Link */}
          <div className="border border-border rounded-lg p-4 bg-card">
            <h4 className="text-sm font-medium text-foreground mb-2">eBay-Listing (Demo)</h4>
            <p className="text-xs text-muted-foreground mb-3">
              Sobald dein eBay-Konto verbunden ist, wird hier das echte Listing verlinkt.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={ebayMockUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" />
                  Auf eBay ansehen (Demo)
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`https://www.amazon.de/dp/${product.source_id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" />
                  Auf Amazon ansehen
                </a>
              </Button>
          </div>

          {/* Delete */}
          {onDelete && (
            <div className="pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onDelete(product)}
              >
                <Trash2 className="w-4 h-4" />
                Produkt löschen
              </Button>
            </div>
          )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
