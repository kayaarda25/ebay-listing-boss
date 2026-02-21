import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Package, AlertCircle, CheckCircle2 } from "lucide-react";
import { calculateEbayPrice, type PricingConfig } from "@/components/PricingSettings";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

function extractAsins(text: string): string[] {
  const asinRegex = /(?:\/(?:dp|gp\/product|ASIN)\/|(?:^|\s))([A-Z0-9]{10})(?:\s|\/|$|\?)/gi;
  const asins = new Set<string>();

  for (const match of text.matchAll(asinRegex)) {
    asins.add(match[1].toUpperCase());
  }

  const standaloneRegex = /\b(B[A-Z0-9]{9})\b/g;
  for (const match of text.matchAll(standaloneRegex)) {
    asins.add(match[1].toUpperCase());
  }

  return Array.from(asins);
}

export function ImportDialog({ open, onOpenChange, onSuccess }: ImportDialogProps) {
  const { sellerId } = useAuth();
  const [input, setInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<{ added: string[]; skipped: string[]; scraped: number } | null>(null);

  const detectedAsins = input.trim() ? extractAsins(input) : [];

  async function handleImport() {
    if (!sellerId || detectedAsins.length === 0) return;

    setImporting(true);
    setResults(null);
    setStatus("Prüfe Duplikate...");

    try {
      // Check which ASINs already exist
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

      // Step 1: Insert placeholders
      setStatus(`Erstelle ${newAsins.length} Produkt(e)...`);
      const rows = newAsins.map((asin) => ({
        seller_id: sellerId,
        source_type: "amazon",
        source_id: asin,
        title: `Amazon ${asin}`,
      }));
      const { error: insertError } = await supabase.from("source_products").insert(rows);
      if (insertError) throw insertError;

      // Fetch pricing settings for eBay price calculation
      const { data: sellerData } = await supabase
        .from("sellers")
        .select("pricing_settings")
        .eq("id", sellerId)
        .maybeSingle();
      const pricingConfig: PricingConfig = {
        margin_percent: 20, shipping_cost: 4.99, ebay_fee_percent: 13,
        paypal_fee_percent: 2.49, paypal_fee_fixed: 0.35, additional_costs: 0,
        auto_sync_enabled: true, sync_interval_hours: 6,
        ...(sellerData?.pricing_settings as unknown as PricingConfig || {}),
      };

      // Step 2: Scrape product data from Amazon
      setStatus(`Lade Produktdaten von Amazon (${newAsins.length} Produkt(e))...`);
      let scrapedCount = 0;

      try {
        const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke("scrape-amazon", {
          body: { asins: newAsins },
        });

        if (!scrapeError && scrapeData?.success && scrapeData.results) {
          for (const asin of newAsins) {
            const productData = scrapeData.results[asin];
            if (productData?.success) {
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
                    brand: productData.brand,
                    manufacturer: productData.manufacturer,
                    mpn: productData.mpn,
                    ean: productData.ean,
                    color: productData.color,
                    size: productData.size,
                    material: productData.material,
                    weight: productData.weight,
                    dimensions: productData.dimensions,
                    category: productData.category,
                    rating: productData.rating,
                    review_count: productData.review_count,
                    energy_class: productData.energy_class,
                    bullet_points: productData.bullet_points,
                    technical_details: productData.technical_details,
                    availability: productData.availability,
                  },
                  last_synced_at: new Date().toISOString(),
                })
                .eq("seller_id", sellerId)
                .eq("source_id", asin);

              if (!updateError) scrapedCount++;

              // Step 3: Auto-optimize with AI
              setStatus(`AI optimiert ${asin}...`);
              try {
                const { data: aiData, error: aiError } = await supabase.functions.invoke("optimize-listing", {
                  body: {
                    title: productData.title,
                    description: productData.description,
                    brand: productData.brand,
                  },
                });

                if (!aiError && aiData?.success) {
                  await supabase
                    .from("source_products")
                    .update({
                      title: aiData.title,
                      description: aiData.description,
                      attributes_json: {
                        brand: productData.brand,
                        manufacturer: productData.manufacturer,
                        mpn: productData.mpn,
                        ean: productData.ean,
                        color: productData.color,
                        size: productData.size,
                        material: productData.material,
                        weight: productData.weight,
                        dimensions: productData.dimensions,
                        category: productData.category,
                        rating: productData.rating,
                        review_count: productData.review_count,
                        energy_class: productData.energy_class,
                        bullet_points: productData.bullet_points,
                        technical_details: productData.technical_details,
                        availability: productData.availability,
                        original_title: productData.title,
                        original_description: productData.description,
                      },
                    })
                    .eq("seller_id", sellerId)
                    .eq("source_id", asin);
                }
              } catch (aiErr) {
                console.warn("AI optimization failed (product still saved):", aiErr);
              }

              // Step 4: Generate AI product image
              setStatus(`Erstelle AI-Produktbild für ${asin}...`);
              try {
                const { data: imgData, error: imgError } = await supabase.functions.invoke("generate-product-image", {
                  body: {
                    title: productData.title,
                    asin,
                  },
                });

                if (!imgError && imgData?.success && imgData.imageUrl) {
                  const currentImages = Array.isArray(productData.images) ? productData.images : [];
                  await supabase
                    .from("source_products")
                    .update({
                      images_json: [imgData.imageUrl, ...currentImages],
                    })
                    .eq("seller_id", sellerId)
                    .eq("source_id", asin);
                }
              } catch (imgErr) {
                console.warn("AI image generation failed (product still saved):", imgErr);
              }
            }
          }
        } else {
          console.warn("Scrape failed, products saved with placeholder data:", scrapeError);
        }
      } catch (scrapeErr) {
        console.warn("Scraping error (products still saved):", scrapeErr);
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
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Produkte importieren
          </DialogTitle>
          <DialogDescription>
            Füge Amazon-URLs oder ASINs ein (eine pro Zeile). Produktdaten werden automatisch von Amazon geladen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Textarea
            placeholder={"https://www.amazon.de/dp/B0EXAMPLE1\nhttps://amazon.de/gp/product/B0EXAMPLE2\nB0EXAMPLE3"}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setResults(null);
            }}
            rows={6}
            className="font-mono text-sm"
            disabled={importing}
          />

          {detectedAsins.length > 0 && !results && !importing && (
            <div className="flex flex-wrap gap-1.5">
              {detectedAsins.map((asin) => (
                <span
                  key={asin}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-mono"
                >
                  {asin}
                </span>
              ))}
              <span className="text-xs text-muted-foreground self-center ml-1">
                {detectedAsins.length} ASIN(s) erkannt
              </span>
            </div>
          )}

          {importing && status && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              {status}
            </div>
          )}

          {detectedAsins.length === 0 && input.trim().length > 0 && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Keine gültigen ASINs erkannt. Bitte prüfe die URLs.
            </div>
          )}

          {results && (
            <div className="space-y-2 text-sm">
              {results.added.length > 0 && (
                <div className="flex items-start gap-2 text-primary">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {results.added.length} importiert, {results.scraped} mit Amazon-Daten angereichert
                  </span>
                </div>
              )}
              {results.skipped.length > 0 && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{results.skipped.length} bereits vorhanden: {results.skipped.join(", ")}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={importing}>
            {results ? "Schließen" : "Abbrechen"}
          </Button>
          {!results && (
            <Button
              onClick={handleImport}
              disabled={importing || detectedAsins.length === 0}
            >
              {importing && <Loader2 className="w-4 h-4 animate-spin" />}
              {importing ? "Importiere..." : `${detectedAsins.length} Produkt(e) importieren`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
