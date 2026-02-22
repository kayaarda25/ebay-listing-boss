import { getCJAccessToken, CJ_BASE } from "../_shared/cj-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { query, pageNum = 1, pageSize = 20, productId, countryCode, categoryId, freightForProduct } = await req.json();

    const token = await getCJAccessToken();

    // Calculate freight for a specific product to a country
    if (freightForProduct) {
      const freightRes = await fetch(`${CJ_BASE}/logistic/freightCalculate`, {
        method: "POST",
        headers: { "CJ-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({
          endCountryCode: countryCode || "DE",
          products: [{ quantity: 1, vid: freightForProduct }],
        }),
      });
      const freightData = await freightRes.json();
      
      return new Response(JSON.stringify({ 
        success: true, 
        freight: freightData.data || [],
        raw: freightData,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If productId is provided, fetch single product detail
    if (productId) {
      const res = await fetch(`${CJ_BASE}/product/query?pid=${productId}`, {
        headers: { "CJ-Access-Token": token },
      });
      const data = await res.json();
      if (data.code !== 200) throw new Error(data.message || "CJ product query failed");

      return new Response(JSON.stringify({ success: true, product: data.data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Search products by keyword
    if (!query) {
      return new Response(JSON.stringify({ success: false, error: "query or productId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build search URL with query params
    const searchUrl = new URL(`${CJ_BASE}/product/list`);
    searchUrl.searchParams.set("productNameEn", query);
    searchUrl.searchParams.set("pageNum", String(pageNum));
    searchUrl.searchParams.set("pageSize", String(pageSize));
    if (countryCode && countryCode !== "all") searchUrl.searchParams.set("countryCode", countryCode);
    if (categoryId) searchUrl.searchParams.set("categoryId", categoryId);

    const searchRes = await fetch(searchUrl.toString(), {
      headers: { "CJ-Access-Token": token },
    });
    const searchData = await searchRes.json();

    if (searchData.code !== 200) throw new Error(searchData.message || "CJ search failed");

    const rawProducts = searchData.data?.list || [];

    // Filter out removed/invalid products
    const validProducts = rawProducts.filter((p: any) => {
      // Skip products with no price
      if (!p.sellPrice && !p.productPrice) return false;
      // Skip products explicitly marked as removed/invalid
      if (p.productStatus && p.productStatus !== "VALID" && p.productStatus !== "ON_SALE") return false;
      // Skip products with no image
      if (!p.productImage && (!p.productImageSet || p.productImageSet.length === 0)) return false;
      return true;
    });

    return new Response(JSON.stringify({
      success: true,
      products: validProducts,
      total: searchData.data?.total || 0,
      pageNum,
      pageSize,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("CJ search error:", error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
