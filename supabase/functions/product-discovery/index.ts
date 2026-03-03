import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCJAccessToken, CJ_BASE } from "../_shared/cj-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Product Discovery Worker
 * Searches CJ Dropshipping for winning EU-warehouse products,
 * generates optimized titles/descriptions, creates listings automatically.
 * 
 * Designed to be called via cron (every 6 hours) or manually.
 */

const EU_COUNTRIES = ["DE", "PL", "ES", "FR", "CZ", "NL", "IT", "BE"];
const SEARCH_QUERIES = [
  "kitchen gadget", "phone accessories", "car accessories", "home decor",
  "pet supplies", "beauty tools", "LED lights", "fitness accessories",
  "desk organizer", "travel accessories", "cleaning tools", "garden tools",
  "bathroom accessories", "baby products", "camping gear", "office supplies",
  "jewelry", "watch accessories", "sunglasses", "bag accessories",
  "hair accessories", "nail art", "makeup tools", "yoga accessories",
  "gaming accessories", "laptop stand", "cable organizer", "water bottle",
  "massage tools", "smart home",
];

const MIN_PRICE = 2;
const MAX_PRICE = 35;
const MIN_IMAGES = 3;

// Blocked categories: clothing, fashion, apparel
const BLOCKED_KEYWORDS = [
  "dress", "shirt", "blouse", "skirt", "pants", "trousers", "jeans",
  "jacket", "coat", "sweater", "hoodie", "t-shirt", "tshirt", "top",
  "legging", "shorts", "underwear", "bra", "lingerie", "sock",
  "clothing", "apparel", "fashion", "garment", "outfit", "costume",
  "romper", "jumpsuit", "cardigan", "vest", "blazer", "suit",
  "kleid", "hemd", "bluse", "rock", "hose", "jacke", "mantel",
  "pullover", "unterwäsche", "bekleidung", "mode",
];
const TARGET_PROFIT = 15; // €15 target profit per product
const MAX_PROFIT = 20;    // €20 cap
const EBAY_FEE_PCT = 0.13;       // 13% eBay final value fee
const PROMOTED_FEE_PCT = 0.05;   // 5% Basis-Anzeige (promoted listing)
const PAYPAL_FEE_PCT = 0.0249;   // 2.49% PayPal
const PAYPAL_FEE_FIXED = 0.35;   // €0.35 PayPal fixed
const TOTAL_FEE_PCT = EBAY_FEE_PCT + PROMOTED_FEE_PCT + PAYPAL_FEE_PCT; // 20.49%
const DAILY_LISTING_TARGET = 20;

interface DiscoveredProduct {
  pid: string;
  name: string;
  price: number;
  image: string;
  images: string[];
  variants: any[];
  warehouse: string;
  shippingCost: number;
  score: number;
}

// Rate limiter: CJ API allows 1 request per second
let lastCJCallTime = 0;
async function rateLimitedCJFetch(url: string | URL, options?: RequestInit): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastCJCallTime;
  if (elapsed < 1100) {
    await new Promise(r => setTimeout(r, 1100 - elapsed));
  }
  lastCJCallTime = Date.now();
  return fetch(url.toString(), options);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const sellerId = body.sellerId;
    const maxProducts = body.maxProducts || 10;
    const queries = body.queries || SEARCH_QUERIES;
    const skipListing = body.skipListing || false;

    if (!sellerId) {
      return jsonRes({ ok: false, error: "sellerId required" }, 422);
    }

    // Check how many listings created today (resets at 00:00 UTC)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { count: todayCount } = await supabase
      .from("ebay_offers")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", sellerId)
      .gte("created_at", todayStart.toISOString());

    const remaining = Math.max(0, DAILY_LISTING_TARGET - (todayCount || 0));
    if (remaining === 0 && !skipListing) {
      return jsonRes({ ok: true, message: "Daily target reached", todayCount });
    }

    const token = await getCJAccessToken();
    const discovered: DiscoveredProduct[] = [];
    const errors: string[] = [];

    // Pick random queries to search
    const shuffled = [...queries].sort(() => Math.random() - 0.5);
    const searchQueries = shuffled.slice(0, Math.min(3, shuffled.length));

    for (const query of searchQueries) {
      if (discovered.length >= maxProducts) break;

      try {
        // Search CJ - China warehouse only
        for (const country of ["CN"]) {
          if (discovered.length >= maxProducts) break;

          const searchUrl = new URL(`${CJ_BASE}/product/list`);
          searchUrl.searchParams.set("productNameEn", query);
          searchUrl.searchParams.set("pageNum", "1");
          searchUrl.searchParams.set("pageSize", "20");
          searchUrl.searchParams.set("countryCode", country);

          const res = await rateLimitedCJFetch(searchUrl.toString(), {
            headers: { "CJ-Access-Token": token },
          });
          const data = await res.json();
          console.log(`CJ search "${query}" country=${country}: code=${data.code}, results=${data.data?.list?.length || 0}`);
          if (data.code !== 200) {
            console.log(`CJ error response:`, JSON.stringify(data).substring(0, 500));
            continue;
          }

          const products = data.data?.list || [];

          for (const p of products) {
            if (discovered.length >= maxProducts) break;

            const rawPrice = p.sellPrice || p.productPrice || 0;
            // Handle price ranges like "125.29 -- 139.85" by taking the lower value
            const price = typeof rawPrice === "string" ? parseFloat(rawPrice) : rawPrice;
            if (isNaN(price)) continue;
            console.log(`Product: ${p.productNameEn?.substring(0, 40)} price=${price} status=${p.productStatus} images=${p.productImageSet?.length || 0}`);

            // Apply filters
            if (price < MIN_PRICE || price > MAX_PRICE) continue;
            if (!p.productImage && (!p.productImageSet || p.productImageSet.length === 0)) continue;
            
            // Skip removed/invalid products
            if (p.productStatus && !["VALID", "ON_SALE", "IN_STOCK"].includes(p.productStatus)) {
              console.log(`Skipping removed/invalid product ${p.pid}: status=${p.productStatus}`);
              continue;
            }

            // Skip clothing/fashion products
            const nameLower = (p.productNameEn || p.productName || "").toLowerCase();
            if (BLOCKED_KEYWORDS.some(kw => nameLower.includes(kw))) {
              console.log(`Skipping clothing product: ${nameLower.substring(0, 50)}`);
              continue;
            }

            // Verify product is still available via detail API & get full images
            let detailProduct: any = null;
            try {
              const detailRes = await rateLimitedCJFetch(`${CJ_BASE}/product/query?pid=${p.pid}`, {
                headers: { "CJ-Access-Token": token },
              });
              const detailData = await detailRes.json();
              if (detailData.code !== 200 || !detailData.data) {
                console.log(`Product ${p.pid} no longer available on CJ, skipping`);
                continue;
              }
              detailProduct = detailData.data;
            } catch {
              console.log(`Could not verify product ${p.pid}, skipping`);
              continue;
            }

            // Skip duplicate PID already discovered in this run
            if (discovered.some((d) => d.pid === p.pid)) {
              console.log(`Skipping duplicate PID in batch: ${p.pid}`);
              continue;
            }

            // Check if already imported (exact match)
            const { data: existing } = await supabase
              .from("source_products")
              .select("id")
              .eq("source_id", p.pid)
              .eq("seller_id", sellerId)
              .maybeSingle();
            if (existing) continue;

            // Check for duplicates: similar title already in DB
            const titleWords = extractKeywords(p.productNameEn || p.productName || "");
            if (titleWords.length >= 2) {
              const { data: similarProducts } = await supabase
                .from("source_products")
                .select("id, title, images_json")
                .eq("seller_id", sellerId)
                .ilike("title", `%${titleWords[0]}%`);
              
              const isDuplicate = (similarProducts || []).some((sp: any) => {
                const similarity = calculateTitleSimilarity(
                  (p.productNameEn || p.productName || "").toLowerCase(),
                  (sp.title || "").toLowerCase()
                );
                if (similarity >= 0.65) {
                  console.log(`Skipping duplicate (title ${Math.round(similarity * 100)}% similar): "${(p.productNameEn || "").substring(0, 50)}" ~ "${(sp.title || "").substring(0, 50)}"`);
                  return true;
                }
                // Check image overlap
                const existingImages = normalizeImageUrls(sp.images_json);
                const newImages = normalizeImageUrls([p.productImageSet, p.productImage]);
                const sharedImages = newImages.filter((img: string) => existingImages.includes(img));
                if (newImages.length > 0 && sharedImages.length >= Math.ceil(newImages.length * 0.5)) {
                  console.log(`Skipping duplicate (${sharedImages.length} shared images): "${(p.productNameEn || "").substring(0, 50)}"`);
                  return true;
                }
                return false;
              });
              if (isDuplicate) continue;

              // Also check against already-discovered products in this batch
              const batchDup = discovered.some(d => {
                const sim = calculateTitleSimilarity(
                  (p.productNameEn || p.productName || "").toLowerCase(),
                  d.name.toLowerCase()
                );
                return sim >= 0.65;
              });
              if (batchDup) {
                console.log(`Skipping batch duplicate: "${(p.productNameEn || "").substring(0, 50)}"`);
                continue;
              }
            }

            // Get ALL images from detail + list API (normalized + deduplicated)
            const detailImages = normalizeImageUrls([
              detailProduct?.productImageSet,
              detailProduct?.productImage,
            ]);
            const listImages = normalizeImageUrls([
              p.productImageSet,
              p.productImage,
            ]);
            const allImages = [...new Set([...detailImages, ...listImages])];
            const goodImages = filterImages(allImages);
            if (goodImages.length < MIN_IMAGES) continue;

            console.log(`Product ${p.pid}: ${goodImages.length} images from detail API`);

            // Use variants from detail API if available (more complete)
            const detailVariants = detailProduct?.variants || p.variants || [];

            // Calculate shipping to DE
            let shippingCost = 3.0; // default estimate
            try {
              const vid = detailVariants[0]?.vid || p.variants?.[0]?.vid;
              if (vid) {
                const freightRes = await rateLimitedCJFetch(`${CJ_BASE}/logistic/freightCalculate`, {
                  method: "POST",
                  headers: { "CJ-Access-Token": token, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    endCountryCode: "DE",
                    products: [{ quantity: 1, vid }],
                  }),
                });
                const freightData = await freightRes.json();
                if (freightData.data?.length > 0) {
                  const cheapest = freightData.data
                    .filter((f: any) => f.logisticPrice)
                    .sort((a: any, b: any) => a.logisticPrice - b.logisticPrice)[0];
                  if (cheapest) shippingCost = cheapest.logisticPrice;
                }
              }
            } catch { /* use default */ }

            // Score product
            const score = calculateScore(p, price, shippingCost, country);

            discovered.push({
              pid: p.pid,
              name: p.productNameEn || p.productName || "",
              price,
              image: goodImages[0],
              images: goodImages,
              variants: detailVariants.map((v: any) => ({
                vid: v.vid,
                name: v.variantNameEn || v.variantName,
                price: v.variantSellPrice || v.variantPrice || price,
                image: v.variantImage,
              })),
              warehouse: country,
              shippingCost,
              score,
            });

            // Rate limiting handled by rateLimitedCJFetch
          }
        }
      } catch (err) {
        errors.push(`Query "${query}": ${err}`);
      }
    }

    // Sort by score (best first)
    discovered.sort((a, b) => b.score - a.score);

    // Import discovered products
    const imported: any[] = [];
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    for (const product of discovered.slice(0, Math.min(remaining, maxProducts))) {
      try {
        // Generate optimized title
        const optimizedTitle = await generateTitle(product.name, LOVABLE_API_KEY);

        // Generate description
        const description = await generateDescription(product.name, optimizedTitle, LOVABLE_API_KEY);

        // Calculate selling price: VK = (EK + Versand + PayPal-Fix + Profit) / (1 - Gebühren%)
        const baseCost = product.price + product.shippingCost + PAYPAL_FEE_FIXED;
        let profit = TARGET_PROFIT;
        let sellingPrice = (baseCost + profit) / (1 - TOTAL_FEE_PCT);
        
        // Cap profit at MAX_PROFIT
        const actualProfit = sellingPrice - baseCost - (sellingPrice * TOTAL_FEE_PCT);
        if (actualProfit > MAX_PROFIT) {
          profit = MAX_PROFIT;
          sellingPrice = (baseCost + profit) / (1 - TOTAL_FEE_PCT);
        }
        
        // Round to .99
        sellingPrice = Math.floor(sellingPrice) + 0.99;

        // No EU tags - CN warehouse only
        const euTags: string[] = [];

        const variantId = product.variants[0]?.vid || product.pid;

        // Store as source_product
        const { data: sp, error: spErr } = await supabase
          .from("source_products")
          .upsert({
            seller_id: sellerId,
            source_id: product.pid,
            source_type: "cjdropshipping",
            title: optimizedTitle,
            description: description,
            price_source: product.price,
            price_ebay: sellingPrice,
            images_json: product.images,
            variants_json: product.variants,
            attributes_json: {
              warehouse: product.warehouse,
              shipping_cost: product.shippingCost,
              score: product.score,
              eu_tags: euTags,
              discovery_date: new Date().toISOString(),
              auto_discovered: true,
              price_breakdown: {
                purchase_price: product.price,
                shipping_cost: product.shippingCost,
                ebay_fee: Math.round(sellingPrice * EBAY_FEE_PCT * 100) / 100,
                promoted_fee: Math.round(sellingPrice * PROMOTED_FEE_PCT * 100) / 100,
                paypal_fee: Math.round((sellingPrice * PAYPAL_FEE_PCT + PAYPAL_FEE_FIXED) * 100) / 100,
                total_costs: Math.round((product.price + product.shippingCost + sellingPrice * TOTAL_FEE_PCT + PAYPAL_FEE_FIXED) * 100) / 100,
                selling_price: sellingPrice,
                net_profit: Math.round((sellingPrice - product.price - product.shippingCost - sellingPrice * TOTAL_FEE_PCT - PAYPAL_FEE_FIXED) * 100) / 100,
              },
            },
          }, { onConflict: "seller_id,source_id" })
          .select("id")
          .single();

        if (spErr) {
          errors.push(`Import ${product.pid}: ${spErr.message}`);
          continue;
        }

        // Create SKU mapping
        await supabase.from("sku_map").upsert({
          seller_id: sellerId,
          ebay_sku: product.pid,
          cj_variant_id: variantId,
          default_qty: 1,
          min_margin_pct: 20,
          active: true,
        }, { onConflict: "seller_id,ebay_sku" });

        // Create/update listing draft if not skipping
        if (!skipListing) {
          const listingTitle = optimizedTitle.substring(0, 80);

          // Prevent duplicate offers per SKU
          const { data: existingOffer } = await supabase
            .from("ebay_offers")
            .select("id, state")
            .eq("seller_id", sellerId)
            .eq("sku", product.pid)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingOffer) {
            const preservedState = ["published", "active", "approved"].includes(existingOffer.state)
              ? existingOffer.state
              : "draft";

            await supabase
              .from("ebay_offers")
              .update({
                title: listingTitle,
                price: sellingPrice,
                quantity: 5,
                state: preservedState,
                source_url: "https://cjdropshipping.com",
              })
              .eq("id", existingOffer.id);
          } else {
            await supabase
              .from("ebay_offers")
              .insert({
                seller_id: sellerId,
                sku: product.pid,
                title: listingTitle,
                price: sellingPrice,
                quantity: 5,
                state: "draft",
                source_url: "https://cjdropshipping.com",
              });
          }
        }

        imported.push({
          pid: product.pid,
          title: optimizedTitle,
          costPrice: product.price,
          sellingPrice,
          warehouse: product.warehouse,
          score: product.score,
          euTags,
        });
      } catch (err) {
        errors.push(`Process ${product.pid}: ${err}`);
      }
    }

    return jsonRes({
      ok: true,
      discovered: discovered.length,
      imported: imported.length,
      todayTotal: (todayCount || 0) + imported.length,
      dailyTarget: DAILY_LISTING_TARGET,
      products: imported,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("Discovery error:", err);
    return jsonRes({ ok: false, error: String(err) }, 500);
  }
});

function calculateScore(product: any, price: number, shippingCost: number, warehouse: string): number {
  let score = 0;

  // Sweet spot pricing: $5-20 range scores highest (not too cheap = junk, not too expensive)
  if (price >= 5 && price <= 20) score += 30;
  else if (price >= 3 && price <= 30) score += 15;
  else score += 5;

  // Prefer lower shipping
  score += Math.max(0, 10 - shippingCost) * 2;

  // Quality indicator: many images = well-presented product
  const imgCount = product.productImageSet?.length || 1;
  score += Math.min(imgCount * 3, 24);

  // Prefer products with variants (more listing options)
  const variantCount = product.variants?.length || product.variantCount || 0;
  score += Math.min(variantCount * 2, 10);

  // Title quality: longer descriptive titles = better product
  const titleLen = (product.productNameEn || "").length;
  if (titleLen > 30) score += 5;

  return Math.round(score * 10) / 10;
}

function normalizeImageUrls(input: unknown): string[] {
  const out: string[] = [];

  const collect = (value: unknown) => {
    if (value == null) return;

    if (Array.isArray(value)) {
      for (const v of value) collect(v);
      return;
    }

    if (typeof value !== "string") return;

    const trimmed = value.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        collect(parsed);
        return;
      } catch {
        // fall through and treat as normal string
      }
    }

    if (trimmed.startsWith("http")) out.push(trimmed);
  };

  collect(input);
  return [...new Set(out)];
}

function filterImages(images: string[]): string[] {
  return images.filter((url: string) => {
    if (!url || typeof url !== "string") return false;
    // Skip obvious watermark/low-quality indicators
    if (url.includes("watermark")) return false;
    if (url.includes("logo")) return false;
    return true;
  });
}

async function generateTitle(productName: string, apiKey?: string | null): Promise<string> {
  if (!apiKey) {
    // Fallback: clean up the CJ title
    return cleanTitle(productName);
  }

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Du bist ein eBay-Listing-Titel-Optimierer für den deutschen Markt. Erstelle einen kurzen, keyword-reichen eBay-Titel auf Deutsch.
Regeln:
- Max 80 Zeichen
- Struktur: Hauptkeyword + Vorteil + Anwendung
- Keine Sonderzeichen außer – und &
- Keine Markennamen, verwende "Kompatibel mit..." oder lasse die Marke weg
- NUR auf Deutsch
- Antworte NUR mit dem Titel, nichts anderes`,
          },
          {
            role: "user",
            content: `Erstelle einen optimierten deutschen eBay-Titel für: ${productName}`,
          },
        ],
      }),
    });

    if (!res.ok) return cleanTitle(productName);

    const data = await res.json();
    const title = data.choices?.[0]?.message?.content?.trim() || "";
    return title.length > 0 && title.length <= 80 ? title : cleanTitle(productName);
  } catch {
    return cleanTitle(productName);
  }
}

async function generateDescription(productName: string, title: string, apiKey?: string | null): Promise<string> {
  if (!apiKey) {
    return buildFallbackDescription(productName, title);
  }

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Du bist ein eBay-Produktbeschreibungs-Texter für den deutschen Markt. Erstelle eine klare, überzeugende Produktbeschreibung auf Deutsch.

Struktur:
1. 🎯 Produktvorteile (3-4 Aufzählungspunkte)
2. 📦 So funktioniert es (2-3 Sätze)
3. ❤️ Warum Kunden es lieben (3 Aufzählungspunkte)
4. 📋 Lieferumfang (Liste)

Regeln:
- Maximal 500 Wörter
- HTML-Formatierung verwenden (b, ul, li, br)
- Keine Markennamen
- Überzeugend aber ehrlich
- NUR auf Deutsch
- Antworte NUR mit der HTML-Beschreibung`,
          },
          {
            role: "user",
            content: `Erstelle eine deutsche Produktbeschreibung für: ${title}\nOriginalprodukt: ${productName}`,
          },
        ],
      }),
    });

    if (!res.ok) return buildFallbackDescription(productName, title);

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || buildFallbackDescription(productName, title);
  } catch {
    return buildFallbackDescription(productName, title);
  }
}

function cleanTitle(name: string): string {
  return name
    .replace(/\b(CJ|cj|dropship|dropshipping)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 80);
}

function buildFallbackDescription(productName: string, title: string): string {
  return `<b>${title}</b><br><br>
<b>🎯 Produktvorteile:</b><br>
<ul>
<li>Hochwertige Materialien für langlebige Nutzung</li>
<li>Einfach zu verwenden und zu pflegen</li>
<li>Perfekt für den täglichen Gebrauch</li>
</ul><br>
<b>📦 Lieferumfang:</b><br>
<ul><li>1x ${productName}</li></ul>`;
}

function extractKeywords(name: string): string[] {
  const stopWords = new Set(["the", "a", "an", "for", "and", "or", "with", "in", "of", "to", "set", "pcs", "new", "hot"]);
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

function calculateTitleSimilarity(a: string, b: string): number {
  const wordsA = new Set(extractKeywords(a));
  const wordsB = new Set(extractKeywords(b));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }
  return shared / Math.max(wordsA.size, wordsB.size);
}

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  });
}