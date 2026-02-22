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

    const { data: order } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("seller_id", sellerId)
      .maybeSingle();

    if (!order) throw new Error("Order not found");

    const buyer = order.buyer_json as any;
    const cjOrderId = buyer?.cj_order_id;
    if (!cjOrderId) throw new Error("Kein CJ Order ID gefunden. Erstelle zuerst eine CJ-Bestellung.");

    const token = await getCJAccessToken();

    // Query CJ order for tracking info
    const res = await fetch(`${CJ_BASE}/shopping/order/getOrderDetail?orderId=${cjOrderId}`, {
      headers: { "CJ-Access-Token": token },
    });
    const data = await res.json();

    if (data.code !== 200) throw new Error(`CJ query failed: ${data.message}`);

    const cjOrder = data.data;
    const trackingNumber = cjOrder?.trackNumber || cjOrder?.logisticName || "";
    const carrier = cjOrder?.logisticName || "CJPacket";

    if (!trackingNumber) {
      return new Response(JSON.stringify({
        success: false,
        error: "CJ hat noch keine Tracking-Nummer. Bestellung wird noch bearbeitet.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create or update shipment
    const { data: existingShipment } = await supabase
      .from("shipments")
      .select("id")
      .eq("order_id", orderId)
      .maybeSingle();

    if (existingShipment) {
      await supabase.from("shipments").update({
        tracking_number: trackingNumber,
        carrier,
      }).eq("id", existingShipment.id);
    } else {
      await supabase.from("shipments").insert({
        order_id: orderId,
        seller_id: sellerId,
        tracking_number: trackingNumber,
        carrier,
      });
    }

    // Update order status
    await supabase.from("orders").update({ order_status: "shipped" }).eq("id", orderId);

    return new Response(JSON.stringify({
      success: true,
      message: `Tracking ${trackingNumber} (${carrier}) synchronisiert`,
      trackingNumber,
      carrier,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("CJ tracking sync error:", error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
