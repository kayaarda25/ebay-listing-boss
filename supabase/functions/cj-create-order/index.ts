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

    // Look up CJ products through the chain:
    // order items have SKU → ebay_inventory_items (by sku) → source_product_id → source_products (source_type = 'cjdropshipping')
    // Also try direct lookup: items may have itemId which links to ebay_offers listing_id
    
    // Collect all SKUs from order items
    const itemSkus = items.map((i: any) => i.sku).filter(Boolean);
    const itemIds = items.map((i: any) => i.itemId).filter(Boolean);

    console.log("Order items SKUs:", itemSkus, "ItemIDs:", itemIds);

    // Try to find linked CJ source products via ebay_inventory_items
    let cjProducts: any[] = [];
    
    // Path 1: via ebay_inventory_items SKU → source_product
    if (itemSkus.length > 0) {
      const { data: invItems } = await supabase
        .from("ebay_inventory_items")
        .select("sku, source_product_id")
        .eq("seller_id", sellerId)
        .in("sku", itemSkus)
        .not("source_product_id", "is", null);

      if (invItems && invItems.length > 0) {
        const spIds = invItems.map(i => i.source_product_id).filter(Boolean);
        const { data: sourceProds } = await supabase
          .from("source_products")
          .select("*")
          .eq("seller_id", sellerId)
          .eq("source_type", "cjdropshipping")
          .in("id", spIds);
        if (sourceProds) cjProducts.push(...sourceProds);
      }
    }

    // Path 2: via ebay_offers listing_id → sku → ebay_inventory_items → source_product
    if (cjProducts.length === 0 && itemIds.length > 0) {
      const { data: offers } = await supabase
        .from("ebay_offers")
        .select("sku, listing_id")
        .eq("seller_id", sellerId)
        .in("listing_id", itemIds);
      
      if (offers && offers.length > 0) {
        const offerSkus = offers.map(o => o.sku);
        const { data: invItems2 } = await supabase
          .from("ebay_inventory_items")
          .select("sku, source_product_id")
          .eq("seller_id", sellerId)
          .in("sku", offerSkus)
          .not("source_product_id", "is", null);
        
        if (invItems2 && invItems2.length > 0) {
          const spIds2 = invItems2.map(i => i.source_product_id).filter(Boolean);
          const { data: sourceProds2 } = await supabase
            .from("source_products")
            .select("*")
            .eq("seller_id", sellerId)
            .eq("source_type", "cjdropshipping")
            .in("id", spIds2);
          if (sourceProds2) cjProducts.push(...sourceProds2);
        }
      }
    }

    // Path 3: Direct lookup - check if any source_products with source_type='cjdropshipping' exist for this seller
    // and try matching by title similarity (fallback)
    if (cjProducts.length === 0) {
      const { data: allCjProducts } = await supabase
        .from("source_products")
        .select("*")
        .eq("seller_id", sellerId)
        .eq("source_type", "cjdropshipping");
      
      if (!allCjProducts || allCjProducts.length === 0) {
        throw new Error(
          "Keine CJ-Produkte gefunden. Importiere zuerst Produkte über den CJ-Tab im Import-Dialog, " +
          "damit sie mit deinen eBay-Bestellungen verknüpft werden können."
        );
      }

      // Use all CJ products as fallback (user needs to manually link)
      cjProducts = allCjProducts;
    }

    const token = await getCJAccessToken();

    // Build CJ order products from found CJ source products
    const orderProducts = cjProducts.map((p: any) => {
      const variants = p.variants_json || [];
      const firstVariant = variants[0];
      return {
        vid: firstVariant?.vid || p.source_id,
        quantity: items[0]?.quantity || 1,
      };
    }).filter((p: any) => p.vid);

    if (orderProducts.length === 0) {
      throw new Error("CJ-Produkte haben keine gültigen Varianten-IDs. Überprüfe die importierten CJ-Produkte.");
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
