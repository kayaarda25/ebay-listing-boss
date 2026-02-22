import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCJAccessToken, CJ_BASE } from "../_shared/cj-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { orderId, sellerId } = await req.json();
    if (!orderId || !sellerId) throw new Error("orderId and sellerId required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch order with items
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("*, shipments(*)")
      .eq("id", orderId)
      .eq("seller_id", sellerId)
      .maybeSingle();

    if (orderErr || !order) throw new Error("Order not found");

    const buyer = order.buyer_json as any;
    if (!buyer?.address) throw new Error("No shipping address on order");

    const items = buyer.items || [];
    if (items.length === 0) throw new Error("No items in order");

    // Look up CJ product IDs from source_products (source_type = 'cjdropshipping')
    const skus = items.map((i: any) => i.sku).filter(Boolean);
    const { data: sourceProducts } = await supabase
      .from("source_products")
      .select("source_id, title, variants_json")
      .eq("seller_id", sellerId)
      .eq("source_type", "cjdropshipping")
      .in("source_id", skus);

    const cjProductMap = new Map((sourceProducts || []).map(p => [p.source_id, p]));

    const token = await getCJAccessToken();

    // Build CJ order products
    const orderProducts = items.map((item: any) => {
      const cjProduct = cjProductMap.get(item.sku);
      return {
        vid: cjProduct?.variants_json?.[0]?.vid || "",
        quantity: item.quantity || 1,
      };
    }).filter((p: any) => p.vid);

    if (orderProducts.length === 0) {
      throw new Error("Keine CJ-Produkte in dieser Bestellung gefunden. Verknüpfe zuerst die Produkte mit CJDropshipping.");
    }

    const address = buyer.address;
    const cjOrderPayload = {
      orderNumber: order.order_id,
      shippingZip: address.postalCode || "",
      shippingCountryCode: address.country?.length === 2 ? address.country : "DE",
      shippingCountry: address.country || "Germany",
      shippingProvince: address.city || "",
      shippingCity: address.city || "",
      shippingAddress: [address.street1, address.street2].filter(Boolean).join(", "),
      shippingCustomerName: buyer.name || "",
      shippingPhone: address.phone || "",
      remark: `eBay Order ${order.order_id}`,
      products: orderProducts,
    };

    console.log("Creating CJ order:", JSON.stringify(cjOrderPayload));

    const res = await fetch(`${CJ_BASE}/shopping/order/createOrderV2`, {
      method: "POST",
      headers: {
        "CJ-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cjOrderPayload),
    });

    const data = await res.json();
    console.log("CJ order response:", JSON.stringify(data));

    if (data.code !== 200) {
      throw new Error(`CJ Order fehlgeschlagen: ${data.message || JSON.stringify(data)}`);
    }

    const cjOrderId = data.data?.orderId || data.data?.orderNum || "";

    // Update order status
    await supabase
      .from("orders")
      .update({
        order_status: "processing",
        buyer_json: {
          ...buyer,
          cj_order_id: cjOrderId,
        },
      })
      .eq("id", orderId);

    return new Response(JSON.stringify({
      success: true,
      message: `CJ Order erstellt: ${cjOrderId}`,
      cjOrderId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("CJ order error:", error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
