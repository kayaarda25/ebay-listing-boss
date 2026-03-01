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

    // Fetch order
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

    // Collect all SKUs from order items
    const itemSkus = items.map((i: any) => i.sku).filter(Boolean);
    const itemIds = items.map((i: any) => i.itemId).filter(Boolean);

    console.log("Order items SKUs:", itemSkus, "ItemIDs:", itemIds);

    // Build per-item CJ variant mappings
    const orderProducts: { vid: string; quantity: number }[] = [];

    for (const item of items) {
      const sku = item.sku;
      const qty = item.quantity || 1;
      let vid: string | null = null;

      // Path 1: sku_map (ebay_sku → cj_variant_id) — most reliable
      if (sku) {
        const { data: skuMapping } = await supabase
          .from("sku_map")
          .select("cj_variant_id")
          .eq("seller_id", sellerId)
          .eq("ebay_sku", sku)
          .eq("active", true)
          .maybeSingle();
        if (skuMapping) vid = skuMapping.cj_variant_id;
      }

      // Path 2: ebay_inventory_items → source_product → first variant
      if (!vid && sku) {
        const { data: invItem } = await supabase
          .from("ebay_inventory_items")
          .select("source_product_id")
          .eq("seller_id", sellerId)
          .eq("sku", sku)
          .not("source_product_id", "is", null)
          .maybeSingle();

        if (invItem?.source_product_id) {
          const { data: sp } = await supabase
            .from("source_products")
            .select("source_id, variants_json")
            .eq("id", invItem.source_product_id)
            .eq("source_type", "cjdropshipping")
            .maybeSingle();
          if (sp) {
            const variants = (sp.variants_json as any[]) || [];
            vid = variants[0]?.vid || sp.source_id;
          }
        }
      }

      // Path 3: via ebay_offers listing_id → sku → inventory → source_product
      if (!vid && item.itemId) {
        const { data: offer } = await supabase
          .from("ebay_offers")
          .select("sku")
          .eq("seller_id", sellerId)
          .eq("listing_id", item.itemId)
          .maybeSingle();

        if (offer?.sku) {
          const { data: invItem2 } = await supabase
            .from("ebay_inventory_items")
            .select("source_product_id")
            .eq("seller_id", sellerId)
            .eq("sku", offer.sku)
            .not("source_product_id", "is", null)
            .maybeSingle();

          if (invItem2?.source_product_id) {
            const { data: sp2 } = await supabase
              .from("source_products")
              .select("source_id, variants_json")
              .eq("id", invItem2.source_product_id)
              .eq("source_type", "cjdropshipping")
              .maybeSingle();
            if (sp2) {
              const variants = (sp2.variants_json as any[]) || [];
              vid = variants[0]?.vid || sp2.source_id;
            }
          }
        }
      }

      if (vid) {
        orderProducts.push({ vid, quantity: qty });
      } else {
        console.warn(`No CJ variant found for order item SKU=${sku} itemId=${item.itemId}`);
      }
    }

    if (orderProducts.length === 0) {
      throw new Error(
        "Kein CJ-Produkt konnte dem Bestell-Item zugeordnet werden. " +
        "Stelle sicher, dass ein SKU-Mapping (sku_map) oder eine Verknüpfung über ebay_inventory_items existiert."
      );
    }

    const token = await getCJAccessToken();

    if (orderProducts.length === 0) {
      throw new Error("CJ-Produkte haben keine gültigen Varianten-IDs. Überprüfe die importierten CJ-Produkte.");
    }

    const address = buyer.address;
    
    // Map common country names to ISO 2-letter codes
    const countryNameToCode: Record<string, string> = {
      "germany": "DE", "deutschland": "DE", "france": "FR", "frankreich": "FR",
      "austria": "AT", "österreich": "AT", "switzerland": "CH", "schweiz": "CH",
      "netherlands": "NL", "niederlande": "NL", "belgium": "BE", "belgien": "BE",
      "italy": "IT", "italien": "IT", "spain": "ES", "spanien": "ES",
      "poland": "PL", "polen": "PL", "united kingdom": "GB", "großbritannien": "GB",
      "united states": "US", "usa": "US", "china": "CN", "czech republic": "CZ",
      "denmark": "DK", "sweden": "SE", "norway": "NO", "finland": "FI",
      "portugal": "PT", "ireland": "IE", "luxembourg": "LU", "greece": "GR",
    };
    
    let countryCode = "DE"; // default
    const rawCountry = (address.country || "").trim();
    if (rawCountry.length === 2) {
      countryCode = rawCountry.toUpperCase();
    } else if (rawCountry.length > 0) {
      countryCode = countryNameToCode[rawCountry.toLowerCase()] || "DE";
    }
    
    const cjOrderPayload = {
      orderNumber: order.order_id,
      shippingZip: address.postalCode || "",
      shippingCountryCode: countryCode,
      shippingCountry: rawCountry || "Germany",
      shippingProvince: address.state || address.city || "",
      shippingCity: address.city || "",
      shippingAddress: [address.street1, address.street2].filter(Boolean).join(", "),
      shippingCustomerName: buyer.name || "",
      shippingPhone: address.phone || "0000000000",
      fromCountryCode: "CN",
      logisticName: "CJPacket Ordinary",
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
        buyer_json: { ...buyer, cj_order_id: cjOrderId },
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
