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
const MAX_PRICE = 40;
const MIN_IMAGES = 4;
const PRICE_MULTIPLIER = 2.5;
const MIN_MARGIN_PCT = 40;
const DAILY_LISTING_TARGET = 100;

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const sellerId = body.sellerId;
    const maxProducts = body.maxProducts || 20;
    const queries = body.queries || SEARCH_QUERIES;
    const skipListing = body.skipListing || false;

    if (!sellerId) {
      return jsonRes({ ok: false, error: "sellerId required" }, 422);
    }

    // Check how many listings created today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
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
    const searchQueries = shuffled.slice(0, Math.min(5, shuffled.length));

    for (const query of searchQueries) {
      if (discovered.length >= maxProducts) break;

      try {
        // Search CJ with EU country filter
        for (const country of ["DE", "PL", "CZ"]) {
          if (discovered.length >= maxProducts) break;

          const searchUrl = new URL(`${CJ_BASE}/product/list`);
          searchUrl.searchParams.set("productNameEn", query);
          searchUrl.searchParams.set("pageNum", "1");
          searchUrl.searchParams.set("pageSize", "20");
          searchUrl.searchParams.set("countryCode", country);

          const res = await fetch(searchUrl.toString(), {
            headers: { "CJ-Access-Token": token },
          });
          const data = await res.json();
          if (data.code !== 200) continue;

          const products = data.data?.list || [];

          for (const p of products) {
            if (discovered.length >= maxProducts) break;

            const price = p.sellPrice || p.productPrice || 0;

            // Apply filters
            if (price < MIN_PRICE || price > MAX_PRICE) continue;
            if (!p.productImage && (!p.productImageSet || p.productImageSet.length === 0)) continue;
            if (p.productStatus && p.productStatus !== "VALID" && p.productStatus !== "ON_SALE") continue;

            // Check if already imported
            const { data: existing } = await supabase
              .from("source_products")
              .select("id")
              .eq("source_id", p.pid)
              .eq("seller_id", sellerId)
              .maybeSingle();
            if (existing) continue;

            // Get images
            const images = p.productImageSet || (p.productImage ? [p.productImage] : []);
            
            // Filter: need enough images
            const goodImages = filterImages(images);
            if (goodImages.length < MIN_IMAGES) continue;

            // Calculate shipping to DE
            let shippingCost = 3.0; // default estimate
            try {
              if (p.variants?.[0]?.vid) {
                const freightRes = await fetch(`${CJ_BASE}/logistic/freightCalculate`, {
                  method: "POST",
                  headers: { "CJ-Access-Token": token, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    endCountryCode: "DE",
                    products: [{ quantity: 1, vid: p.variants[0].vid }],
                  }),
                });
                const freightData = await freightRes.json();
                if (freightData.data?.length > 0) {
                  // Pick cheapest EU shipping
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
              image: p.productImage || goodImages[0],
              images: goodImages,
              variants: (p.variants || []).map((v: any) => ({
                vid: v.vid,
                name: v.variantNameEn || v.variantName,
                price: v.variantSellPrice || v.variantPrice || price,
                image: v.variantImage,
              })),
              warehouse: country,
              shippingCost,
              score,
            });

            // Rate limit protection
            await new Promise(r => setTimeout(r, 200));
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

        // Calculate selling price
        const totalCost = product.price + product.shippingCost;
        let sellingPrice = totalCost * PRICE_MULTIPLIER;
        
        // Ensure minimum margin
        const minPrice = totalCost / (1 - MIN_MARGIN_PCT / 100);
        if (sellingPrice < minPrice) sellingPrice = minPrice;
        
        // Round to .99
        sellingPrice = Math.floor(sellingPrice) + 0.99;

        // EU shipping tags
        const euTags = EU_COUNTRIES.includes(product.warehouse)
          ? ["Fast EU Shipping", "Delivery 3-7 Days", "EU Warehouse"]
          : [];

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
          min_margin_pct: MIN_MARGIN_PCT,
          active: true,
        }, { onConflict: "seller_id,ebay_sku" });

        // Create listing draft if not skipping
        if (!skipListing) {
          // Build title with EU badge
          const listingTitle = euTags.length > 0
            ? `${optimizedTitle}`.substring(0, 80)
            : optimizedTitle.substring(0, 80);

          // Append EU shipping info to description
          const fullDescription = euTags.length > 0
            ? `${description}\n\n🚀 ${euTags.join(" | ")}`
            : description;

          const { data: offer } = await supabase
            .from("ebay_offers")
            .insert({
              seller_id: sellerId,
              sku: product.pid,
              title: listingTitle,
              price: sellingPrice,
              quantity: 5,
              state: "draft",
              source_url: "https://cjdropshipping.com",
            })
            .select("id")
            .single();

          // Queue publish job
          if (offer) {
            await supabase.from("jobs").insert({
              seller_id: sellerId,
              type: "listing_publish",
              input: { offerId: offer.id },
              state: "queued",
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

  // Prefer lower cost (higher margin potential)
  score += Math.max(0, 40 - price); // up to 40 points

  // Prefer EU core warehouses
  const warehouseScores: Record<string, number> = { DE: 30, PL: 25, CZ: 22, FR: 20, ES: 18 };
  score += warehouseScores[warehouse] || 10;

  // Prefer lower shipping
  score += Math.max(0, 10 - shippingCost) * 2;

  // Prefer products with many images
  const imgCount = product.productImageSet?.length || 1;
  score += Math.min(imgCount * 2, 16);

  // Prefer products with variants
  const variantCount = product.variants?.length || product.variantCount || 0;
  score += Math.min(variantCount * 2, 10);

  return Math.round(score * 10) / 10;
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
            content: `You are an eBay listing title optimizer. Generate a short, keyword-rich eBay title.
Rules:
- Max 80 characters
- Structure: Main keyword + benefit + use case
- No special characters except – and &
- No brand names
- English only
- Return ONLY the title, nothing else`,
          },
          {
            role: "user",
            content: `Generate an optimized eBay title for: ${productName}`,
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
            content: `You are an eBay product description writer. Generate a clear, persuasive product description.

Structure:
1. 🎯 Product Benefits (3-4 bullet points)
2. 📦 How It Works (2-3 sentences)
3. ❤️ Why Customers Love It (3 bullet points)
4. 📋 Package Includes (list items)

Rules:
- Keep it under 500 words
- Use HTML formatting (b, ul, li, br)
- No brand names
- Persuasive but honest tone
- English only
- Return ONLY the HTML description`,
          },
          {
            role: "user",
            content: `Generate description for: ${title}\nOriginal product: ${productName}`,
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
<b>🎯 Product Benefits:</b><br>
<ul>
<li>High quality materials for long-lasting use</li>
<li>Easy to use and maintain</li>
<li>Perfect for everyday use</li>
</ul><br>
<b>📦 Package Includes:</b><br>
<ul><li>1x ${productName}</li></ul>`;
}

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  });
}