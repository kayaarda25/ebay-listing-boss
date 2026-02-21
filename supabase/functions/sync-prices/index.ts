import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface PricingConfig {
  margin_percent: number;
  shipping_cost: number;
  ebay_fee_percent: number;
  paypal_fee_percent: number;
  paypal_fee_fixed: number;
  additional_costs: number;
  pause_if_ek_above?: number | null;
  min_profit?: number | null;
  max_price_change_percent?: number | null;
}

function calculateEbayPrice(amazonPrice: number, config: PricingConfig): number {
  const totalCost = amazonPrice + config.shipping_cost + config.additional_costs;
  const costWithMargin = totalCost * (1 + config.margin_percent / 100);
  const totalFeePercent = (config.ebay_fee_percent + config.paypal_fee_percent) / 100;
  const ebayPrice = (costWithMargin + config.paypal_fee_fixed) / (1 - totalFeePercent);
  return Math.ceil(ebayPrice * 100) / 100;
}

function calculateProfit(ebayPrice: number, amazonPrice: number, config: PricingConfig): number {
  const ebayFee = ebayPrice * (config.ebay_fee_percent / 100);
  const paypalFee = ebayPrice * (config.paypal_fee_percent / 100) + config.paypal_fee_fixed;
  return ebayPrice - amazonPrice - config.shipping_cost - config.additional_costs - ebayFee - paypalFee;
}

function shouldPause(amazonPrice: number, ebayPrice: number, config: PricingConfig): string | null {
  if (config.pause_if_ek_above != null && amazonPrice > config.pause_if_ek_above) {
    return `EK (€${amazonPrice}) über Schwellenwert (€${config.pause_if_ek_above})`;
  }
  if (config.min_profit != null) {
    const profit = calculateProfit(ebayPrice, amazonPrice, config);
    if (profit < config.min_profit) {
      return `Gewinn (€${profit.toFixed(2)}) unter Mindestgewinn (€${config.min_profit})`;
    }
  }
  return null;
}

function clampPriceChange(oldPrice: number, newPrice: number, maxChangePercent: number | null | undefined): number {
  if (!maxChangePercent || !oldPrice) return newPrice;
  const maxDelta = oldPrice * (maxChangePercent / 100);
  if (newPrice > oldPrice + maxDelta) return Math.ceil((oldPrice + maxDelta) * 100) / 100;
  if (newPrice < oldPrice - maxDelta) return Math.ceil((oldPrice - maxDelta) * 100) / 100;
  return newPrice;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sellerId } = await req.json();

    if (!sellerId) {
      return new Response(
        JSON.stringify({ success: false, error: 'sellerId ist erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Get seller pricing settings
    const { data: seller, error: sellerError } = await supabase
      .from('sellers')
      .select('pricing_settings')
      .eq('id', sellerId)
      .maybeSingle();

    if (sellerError || !seller) {
      return new Response(
        JSON.stringify({ success: false, error: 'Seller nicht gefunden' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const config: PricingConfig = {
      margin_percent: 20,
      shipping_cost: 4.99,
      ebay_fee_percent: 13,
      paypal_fee_percent: 2.49,
      paypal_fee_fixed: 0.35,
      additional_costs: 0,
      ...(seller.pricing_settings as any || {}),
    };

    // 2. Get all products with Amazon prices
    const { data: products, error: productsError } = await supabase
      .from('source_products')
      .select('id, source_id, price_source, price_ebay, title')
      .eq('seller_id', sellerId)
      .eq('source_type', 'amazon')
      .not('price_source', 'is', null);

    if (productsError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Produkte konnten nicht geladen werden' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!products || products.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'Keine Produkte mit Preisen gefunden', updated: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Re-scrape Amazon prices using Firecrawl
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    let priceUpdates = 0;
    let priceChanges = 0;
    let pausedCount = 0;

    if (apiKey) {
      for (const product of products.slice(0, 25)) {
        try {
          const url = `https://www.amazon.de/dp/${product.source_id}`;
          const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url,
              formats: ['extract'],
              extract: {
                schema: {
                  type: 'object',
                  properties: {
                    price: { type: 'number', description: 'Current price in EUR as a number' },
                    availability: { type: 'string', description: 'Stock availability text' },
                  },
                  required: ['price'],
                },
              },
              waitFor: 2000,
              location: { country: 'DE', languages: ['de'] },
            }),
          });

          const data = await response.json();
          if (response.ok && data.success !== false) {
            const extracted = data.data?.extract || data.extract || {};
            const currentEk = extracted.price || product.price_source!;
            let newEbayPrice = calculateEbayPrice(currentEk, config);

            // Apply max price change rule
            if (product.price_ebay) {
              newEbayPrice = clampPriceChange(product.price_ebay, newEbayPrice, config.max_price_change_percent);
            }

            // Check pause rules
            const pauseReason = shouldPause(currentEk, newEbayPrice, config);

            if (pauseReason) {
              // Pause the offer if exists
              await supabase
                .from('ebay_offers')
                .update({ state: 'paused' })
                .eq('seller_id', sellerId)
                .eq('sku', product.source_id);
              pausedCount++;
              console.log(`PAUSED ${product.source_id}: ${pauseReason}`);
            }

            const updateData: any = {
              price_ebay: newEbayPrice,
              price_synced_at: new Date().toISOString(),
            };

            if (extracted.price && extracted.price !== product.price_source) {
              updateData.price_source = extracted.price;
              updateData.stock_source = extracted.availability?.toLowerCase().includes('auf lager') ? 1 : 0;
              priceChanges++;
              console.log(`${product.source_id}: €${product.price_source} → €${extracted.price} (eBay: €${newEbayPrice})`);
            }

            await supabase
              .from('source_products')
              .update(updateData)
              .eq('id', product.id);

            // Also update offer price
            await supabase
              .from('ebay_offers')
              .update({ price: newEbayPrice })
              .eq('seller_id', sellerId)
              .eq('sku', product.source_id);

            priceUpdates++;
          }
        } catch (err) {
          console.warn(`Failed to check price for ${product.source_id}:`, err);
        }
      }
    } else {
      // No Firecrawl, just recalculate eBay prices from existing data
      for (const product of products) {
        let newEbayPrice = calculateEbayPrice(product.price_source!, config);

        if (product.price_ebay) {
          newEbayPrice = clampPriceChange(product.price_ebay, newEbayPrice, config.max_price_change_percent);
        }

        const pauseReason = shouldPause(product.price_source!, newEbayPrice, config);
        if (pauseReason) {
          await supabase
            .from('ebay_offers')
            .update({ state: 'paused' })
            .eq('seller_id', sellerId)
            .eq('sku', product.source_id);
          pausedCount++;
          console.log(`PAUSED ${product.source_id}: ${pauseReason}`);
        }

        await supabase
          .from('source_products')
          .update({
            price_ebay: newEbayPrice,
            price_synced_at: new Date().toISOString(),
          })
          .eq('id', product.id);

        await supabase
          .from('ebay_offers')
          .update({ price: newEbayPrice })
          .eq('seller_id', sellerId)
          .eq('sku', product.source_id);

        priceUpdates++;
      }
    }

    const parts = [];
    if (priceUpdates) parts.push(`${priceUpdates} geprüft`);
    if (priceChanges) parts.push(`${priceChanges} Preisänderungen`);
    if (pausedCount) parts.push(`${pausedCount} pausiert (Regeln)`);
    const message = parts.join(', ') || 'Keine Änderungen';

    console.log(`Sync complete for seller ${sellerId}: ${message}`);

    return new Response(
      JSON.stringify({ success: true, message, updated: priceUpdates, changed: priceChanges, paused: pausedCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
