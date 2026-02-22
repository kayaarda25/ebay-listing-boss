import { getCJAccessToken, CJ_BASE } from "../_shared/cj-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { sellerId } = await req.json();
    if (!sellerId) throw new Error("sellerId required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get all CJ products for this seller
    const { data: products, error } = await supabase
      .from("source_products")
      .select("id, source_id, attributes_json")
      .eq("seller_id", sellerId)
      .eq("source_type", "cjdropshipping");

    if (error) throw error;
    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ success: true, updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getCJAccessToken();
    let updated = 0;

    for (const product of products) {
      try {
        // Small delay to avoid rate limiting
        if (updated > 0) await new Promise(r => setTimeout(r, 1000));

        const res = await fetch(`${CJ_BASE}/product/query?pid=${product.source_id}`, {
          headers: { "CJ-Access-Token": token },
        });
        const data = await res.json();
        if (data.code !== 200 || !data.data) continue;

        const detail = data.data;
        const existing = (product.attributes_json || {}) as Record<string, any>;

        // Extract warehouse info
        let warehouse = detail.sourceFrom || detail.warehouseName || null;
        if (!warehouse && detail.supplierName) warehouse = detail.supplierName;

        const updatedAttrs = {
          ...existing,
          warehouse: warehouse || existing.warehouse || null,
          shipping_time: detail.logisticAging || detail.deliveryDays || existing.shipping_time || null,
          shipping_cost: detail.logisticPrice || detail.shippingPrice || existing.shipping_cost || null,
          packing_weight: detail.packingWeight ? `${detail.packingWeight}g` : existing.packing_weight || null,
          material: detail.material || existing.material || null,
          origin_country: detail.productFrom || existing.origin_country || null,
          weight: detail.productWeight ? `${detail.productWeight}g` : existing.weight || null,
          category: detail.categoryName || existing.category || null,
        };

        await supabase.from("source_products").update({
          attributes_json: updatedAttrs,
          stock_source: detail.productStock ?? undefined,
        }).eq("id", product.id);

        updated++;
      } catch (e) {
        console.warn(`Failed to update ${product.source_id}:`, e);
      }
    }

    return new Response(JSON.stringify({ success: true, updated, total: products.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("CJ refresh error:", error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
