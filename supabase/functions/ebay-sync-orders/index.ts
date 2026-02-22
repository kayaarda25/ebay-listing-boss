import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEbayAccessToken, EBAY_API_BASE } from "../_shared/ebay-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sellerId } = await req.json();
    if (!sellerId) {
      return new Response(JSON.stringify({ success: false, error: 'sellerId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getEbayAccessToken();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch orders from eBay Fulfillment API (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateFilter = thirtyDaysAgo.toISOString();

    let allOrders: any[] = [];
    let offset = 0;
    const limit = 50;
    let hasMore = true;

    while (hasMore) {
      const url = `${EBAY_API_BASE}/sell/fulfillment/v1/order?filter=creationdate:[${dateFilter}..]&limit=${limit}&offset=${offset}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`eBay Orders API [${response.status}]: ${errText}`);
      }

      const data = await response.json();
      const orders = data.orders || [];
      allOrders = allOrders.concat(orders);
      hasMore = orders.length === limit;
      offset += limit;
    }

    let imported = 0;
    let updated = 0;

    for (const order of allOrders) {
      const orderId = order.orderId;
      const totalPrice = parseFloat(order.pricingSummary?.total?.value || "0");
      const currency = order.pricingSummary?.total?.currency || "EUR";
      const buyer = order.buyer || {};
      const buyerJson = {
        username: buyer.username || null,
        email: buyer.buyerRegistrationAddress?.email || null,
        name: buyer.buyerRegistrationAddress?.fullName || null,
      };

      let status = "pending";
      if (order.orderFulfillmentStatus === "FULFILLED") status = "shipped";
      if (order.orderFulfillmentStatus === "IN_PROGRESS") status = "pending";
      if (order.cancelStatus?.cancelState === "CANCELED") status = "cancelled";

      // Check if order exists
      const { data: existing } = await supabase
        .from('orders')
        .select('id')
        .eq('seller_id', sellerId)
        .eq('order_id', orderId)
        .maybeSingle();

      if (existing) {
        await supabase.from('orders').update({
          order_status: status,
          total_price: totalPrice,
          buyer_json: buyerJson,
          last_synced_at: new Date().toISOString(),
        }).eq('id', existing.id);
        updated++;
      } else {
        const { data: newOrder } = await supabase.from('orders').insert({
          seller_id: sellerId,
          order_id: orderId,
          order_status: status,
          total_price: totalPrice,
          currency,
          buyer_json: buyerJson,
          needs_fulfillment: status === "pending",
          last_synced_at: new Date().toISOString(),
        }).select('id').single();

        // Insert order items
        if (newOrder) {
          for (const lineItem of (order.lineItems || [])) {
            await supabase.from('order_items').insert({
              order_id: newOrder.id,
              seller_id: sellerId,
              sku: lineItem.sku || null,
              line_item_id: lineItem.lineItemId || null,
              quantity: lineItem.quantity || 1,
              price: parseFloat(lineItem.total?.value || "0"),
            });
          }
        }
        imported++;
      }
    }

    const message = `${imported} neu importiert, ${updated} aktualisiert (${allOrders.length} gesamt)`;
    console.log(`Orders sync for ${sellerId}: ${message}`);

    return new Response(
      JSON.stringify({ success: true, message, imported, updated, total: allOrders.length }),
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
