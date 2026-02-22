import { getCJAccessToken, CJ_BASE } from "../_shared/cj-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { query, pageNum = 1, pageSize = 20, productId } = await req.json();

    const token = await getCJAccessToken();

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

    const searchUrl = `${CJ_BASE}/product/list?productNameEn=${encodeURIComponent(query)}&pageNum=${pageNum}&pageSize=${pageSize}`;
    const searchRes = await fetch(searchUrl, {
      headers: { "CJ-Access-Token": token },
    });
    const searchData = await searchRes.json();

    if (searchData.code !== 200) throw new Error(searchData.message || "CJ search failed");

    return new Response(JSON.stringify({
      success: true,
      products: searchData.data?.list || [],
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
