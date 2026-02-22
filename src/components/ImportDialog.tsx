import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Package, AlertCircle, CheckCircle2, Search } from "lucide-react";
import { calculateEbayPrice, type PricingConfig, DEFAULT_PRICING } from "@/components/PricingSettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

function extractAsins(text: string): string[] {
  const asinRegex = /(?:\/(?:dp|gp\/product|ASIN)\/|(?:^|\s))([A-Z0-9]{10})(?:\s|\/|$|\?)/gi;
  const asins = new Set<string>();
  for (const match of text.matchAll(asinRegex)) asins.add(match[1].toUpperCase());
  const standaloneRegex = /\b(B[A-Z0-9]{9})\b/g;
  for (const match of text.matchAll(standaloneRegex)) asins.add(match[1].toUpperCase());
  return Array.from(asins);
}

export function ImportDialog({ open, onOpenChange, onSuccess }: ImportDialogProps) {
  const { sellerId } = useAuth();
  const [tab, setTab] = useState<string>("amazon");
  const [input, setInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState<{ added: string[]; skipped: string[]; scraped: number } | null>(null);

  // CJ search state
  const [cjQuery, setCjQuery] = useState("");
  const [cjSearching, setCjSearching] = useState(false);
  const [cjProducts, setCjProducts] = useState<any[]>([]);
  const [cjImporting, setCjImporting] = useState<string | null>(null);

  const detectedAsins = input.trim() ? extractAsins(input) : [];

  async function handleCJSearch() {
    if (!cjQuery.trim()) return;
    setCjSearching(true);
    setCjProducts([]);
    try {
      const { data, error } = await supabase.functions.invoke("cj-search-products", {
        body: { query: cjQuery.trim() },
      });
      if (error) throw error;
      if (!data?.success) {
        const errMsg = data?.error || "CJ Suche fehlgeschlagen";
        if (errMsg.includes("Too Many Requests") || errMsg.includes("QPS limit")) {
          throw new Error("CJ Rate-Limit erreicht. Bitte warte 5 Minuten und versuche es erneut.");
        }
        throw new Error(errMsg);
      }
      setCjProducts(data.products || []);
      if ((data.products || []).length === 0) toast.info("Keine CJ-Produkte gefunden");
    } catch (err: any) {
      toast.error(err.message || "CJ Suche fehlgeschlagen");
    } finally {
      setCjSearching(false);
    }
  }

  async function handleCJImport(product: any) {
    if (!sellerId) return;
    const pid = product.pid || product.productId || product.id;
    setCjImporting(pid);
    try {
      // Check if already exists
      const { data: existing } = await supabase
        .from("source_products")
        .select("id")
        .eq("seller_id", sellerId)
        .eq("source_type", "cjdropshipping")
        .eq("source_id", pid)
        .maybeSingle();

      if (existing) {
        toast.info("Produkt bereits importiert");
        setCjImporting(null);
        return;
      }

      const images = product.productImageSet || product.productImage ? 
        (product.productImageSet || [product.productImage]).filter(Boolean) : [];

      // Fetch pricing settings
      const { data: sellerData } = await supabase
        .from("sellers")
        .select("pricing_settings")
        .eq("id", sellerId)
        .maybeSingle();
      const pricingConfig: PricingConfig = {
        ...DEFAULT_PRICING,
        ...(sellerData?.pricing_settings as unknown as Partial<PricingConfig> || {}),
      };

      const price = product.sellPrice || product.productPrice || null;
      const ebayPrice = price ? calculateEbayPrice(price, pricingConfig).ebayPrice : null;

      const { error: insertError } = await supabase.from("source_products").insert({
        seller_id: sellerId,
        source_type: "cjdropshipping",
        source_id: pid,
        title: product.productNameEn || product.productName || `CJ ${pid}`,
        description: product.description || product.productNameEn || "",
        price_source: price,
        price_ebay: ebayPrice,
        images_json: images,
        stock_source: product.productStock || 0,
        attributes_json: {
          brand: product.brandName || null,
          weight: product.productWeight ? `${product.productWeight}g` : null,
          category: product.categoryName || null,
          cj_product_id: pid,
        },
        variants_json: (product.variants || []).map((v: any) => ({
          vid: v.vid,
          name: v.variantNameEn || v.variantName,
          price: v.variantSellPrice || v.variantPrice,
          stock: v.variantStock,
          image: v.variantImage,
        })),
        last_synced_at: new Date().toISOString(),
      });

      if (insertError) throw insertError;
      toast.success(`${product.productNameEn || pid} importiert`);
      onSuccess?.();
    } catch (err: any) {
      toast.error(err.message || "Import fehlgeschlagen");
    } finally {
      setCjImporting(null);
    }
  }

  async function handleImport() {
    if (!sellerId || detectedAsins.length === 0) return;
    setImporting(true);
    setResults(null);
    setProgress({ current: 0, total: 0 });
    setStatus("Prüfe Duplikate...");

    try {
      const { data: existing } = await supabase
        .from("source_products")
        .select("source_id")
        .eq("seller_id", sellerId)
        .eq("source_type", "amazon")
        .in("source_id", detectedAsins);

      const existingIds = new Set((existing || []).map((e) => e.source_id));
      const newAsins = detectedAsins.filter((a) => !existingIds.has(a));
      const skippedAsins = detectedAsins.filter((a) => existingIds.has(a));

      if (newAsins.length === 0) {
        setResults({ added: [], skipped: skippedAsins, scraped: 0 });
        toast.info("Alle ASINs bereits vorhanden");
        setImporting(false);
        setStatus("");
        return;
      }

      setStatus(`Erstelle ${newAsins.length} Produkt(e)...`);
      const rows = newAsins.map((asin) => ({
        seller_id: sellerId,
        source_type: "amazon",
        source_id: asin,
        title: `Amazon ${asin}`,
      }));
      const { error: insertError } = await supabase.from("source_products").insert(rows);
      if (insertError) throw insertError;

      const { data: sellerData } = await supabase
        .from("sellers")
        .select("pricing_settings")
        .eq("id", sellerId)
        .maybeSingle();
      const pricingConfig: PricingConfig = {
        ...DEFAULT_PRICING,
        ...(sellerData?.pricing_settings as unknown as Partial<PricingConfig> || {}),
      };

      setStatus(`Lade Produktdaten von Amazon (${newAsins.length} Produkt(e))...`);
      setProgress({ current: 0, total: newAsins.length });
      let scrapedCount = 0;

      try {
        const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke("scrape-amazon", {
          body: { asins: newAsins },
        });

        if (!scrapeError && scrapeData?.success && scrapeData.results) {
          for (const asin of newAsins) {
            const productData = scrapeData.results[asin];
            if (productData?.success) {
              setProgress(prev => ({ ...prev, current: prev.current + 1 }));
              setStatus(`Aktualisiere ${asin}...`);
              const { error: updateError } = await supabase
                .from("source_products")
                .update({
                  title: productData.title,
                  description: productData.description,
                  price_source: productData.price,
                  price_ebay: productData.price ? calculateEbayPrice(productData.price, pricingConfig).ebayPrice : null,
                  stock_source: productData.availability?.toLowerCase().includes("auf lager") ? 1 : 0,
                  images_json: productData.images || [],
                  attributes_json: {
                    brand: productData.brand, manufacturer: productData.manufacturer,
                    mpn: productData.mpn, ean: productData.ean, color: productData.color,
                    size: productData.size, material: productData.material,
                    weight: productData.weight, dimensions: productData.dimensions,
                    category: productData.category, rating: productData.rating,
                    review_count: productData.review_count, energy_class: productData.energy_class,
                    bullet_points: productData.bullet_points,
                    technical_details: productData.technical_details,
                    availability: productData.availability,
                  },
                  last_synced_at: new Date().toISOString(),
                })
                .eq("seller_id", sellerId)
                .eq("source_id", asin);

              if (!updateError) scrapedCount++;

              setStatus(`AI optimiert ${asin}...`);
              try {
                const { data: aiData, error: aiError } = await supabase.functions.invoke("optimize-listing", {
                  body: { title: productData.title, description: productData.description, brand: productData.brand },
                });
                if (!aiError && aiData?.success) {
                  await supabase.from("source_products").update({
                    title: aiData.title, description: aiData.description,
                    attributes_json: {
                      brand: productData.brand, manufacturer: productData.manufacturer,
                      mpn: productData.mpn, ean: productData.ean, color: productData.color,
                      size: productData.size, material: productData.material,
                      weight: productData.weight, dimensions: productData.dimensions,
                      category: productData.category, rating: productData.rating,
                      review_count: productData.review_count, energy_class: productData.energy_class,
                      bullet_points: productData.bullet_points,
                      technical_details: productData.technical_details,
                      availability: productData.availability,
                      original_title: productData.title, original_description: productData.description,
                    },
                  }).eq("seller_id", sellerId).eq("source_id", asin);
                }
              } catch (aiErr) { console.warn("AI optimization failed:", aiErr); }

              setStatus(`Erstelle AI-Produktbild für ${asin}...`);
              try {
                const { data: imgData, error: imgError } = await supabase.functions.invoke("generate-product-image", {
                  body: { title: productData.title, asin },
                });
                if (!imgError && imgData?.success && imgData.imageUrl) {
                  const currentImages = Array.isArray(productData.images) ? productData.images : [];
                  await supabase.from("source_products").update({
                    images_json: [imgData.imageUrl, ...currentImages],
                  }).eq("seller_id", sellerId).eq("source_id", asin);
                }
              } catch (imgErr) { console.warn("AI image generation failed:", imgErr); }
            }
          }
        } else {
          console.warn("Scrape failed:", scrapeError);
        }
      } catch (scrapeErr) {
        console.warn("Scraping error:", scrapeErr);
      }

      setResults({ added: newAsins, skipped: skippedAsins, scraped: scrapedCount });
      toast.success(`${newAsins.length} Produkt(e) importiert, ${scrapedCount} mit Daten angereichert`);
      onSuccess?.();
    } catch (err: any) {
      console.error("Import error:", err);
      toast.error("Import fehlgeschlagen: " + (err.message || "Unbekannter Fehler"));
    } finally {
      setImporting(false);
      setStatus("");
    }
  }

  function handleClose() {
    setInput("");
    setResults(null);
    setStatus("");
    setCjQuery("");
    setCjProducts([]);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Produkte importieren
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="amazon" className="flex-1">Amazon</TabsTrigger>
            <TabsTrigger value="cj" className="flex-1">CJDropshipping</TabsTrigger>
          </TabsList>

          <TabsContent value="amazon" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Füge Amazon-URLs oder ASINs ein (eine pro Zeile, max. 25).
            </p>
            <Textarea
              placeholder={"https://www.amazon.de/dp/B0EXAMPLE1\nB0EXAMPLE3"}
              value={input}
              onChange={(e) => { setInput(e.target.value); setResults(null); }}
              rows={5}
              className="font-mono text-sm"
              disabled={importing}
            />
            {detectedAsins.length > 0 && !results && !importing && (
              <div className="flex flex-wrap gap-1.5">
                {detectedAsins.map((asin) => (
                  <span key={asin} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-mono">
                    {asin}
                  </span>
                ))}
                <span className="text-xs text-muted-foreground self-center ml-1">
                  {detectedAsins.length} ASIN(s) erkannt
                </span>
              </div>
            )}
            {importing && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  {status}
                </div>
                {progress.total > 0 && (
                  <div className="space-y-1">
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground text-right">{progress.current} / {progress.total}</p>
                  </div>
                )}
              </div>
            )}
            {detectedAsins.length === 0 && input.trim().length > 0 && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Keine gültigen ASINs erkannt.
              </div>
            )}
            {results && (
              <div className="space-y-2 text-sm">
                {results.added.length > 0 && (
                  <div className="flex items-start gap-2 text-primary">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{results.added.length} importiert, {results.scraped} mit Daten angereichert</span>
                  </div>
                )}
                {results.skipped.length > 0 && (
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{results.skipped.length} bereits vorhanden</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleClose} disabled={importing}>
                {results ? "Schließen" : "Abbrechen"}
              </Button>
              {!results && (
                <Button onClick={handleImport} disabled={importing || detectedAsins.length === 0}>
                  {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                  {importing ? "Importiere..." : `${detectedAsins.length} importieren`}
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="cj" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Suche nach Produkten auf CJDropshipping und importiere sie direkt.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="z.B. LED strip, phone case..."
                value={cjQuery}
                onChange={(e) => setCjQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCJSearch()}
                className="flex-1"
              />
              <Button onClick={handleCJSearch} disabled={cjSearching || !cjQuery.trim()}>
                {cjSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Suchen
              </Button>
            </div>

            {cjProducts.length > 0 && (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {cjProducts.map((p: any) => {
                  const pid = p.pid || p.productId || p.id;
                  const img = p.productImage || (p.productImageSet || [])[0];
                  return (
                    <div key={pid} className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-card hover:bg-muted/50 transition-colors">
                      {img ? (
                        <img src={img} alt="" className="w-14 h-14 rounded-lg object-contain border border-border/40 bg-white" />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center">
                          <Package className="w-5 h-5 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-foreground line-clamp-2">{p.productNameEn || p.productName || pid}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {p.sellPrice && (
                            <span className="text-xs font-mono font-semibold text-primary">${Number(p.sellPrice).toFixed(2)}</span>
                          )}
                          {p.categoryName && (
                            <span className="text-xs text-muted-foreground">{p.categoryName}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCJImport(p)}
                        disabled={cjImporting === pid}
                        className="shrink-0"
                      >
                        {cjImporting === pid ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Import"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {cjSearching && (
              <div className="py-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Suche auf CJDropshipping...
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
