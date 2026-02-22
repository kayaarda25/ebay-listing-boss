import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ebayTradingCall, xmlValue, xmlAttr, xmlBlocks } from "../_shared/ebay-auth.ts";

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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch orders from eBay using Trading API (GetOrders)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const createTimeFrom = thirtyDaysAgo.toISOString();
    const createTimeTo = new Date().toISOString();

    let pageNumber = 1;
    let hasMore = true;
    let imported = 0;
    let updated = 0;
    let total = 0;

    while (hasMore) {
      const xml = await ebayTradingCall({
        callName: "GetOrders",
        body: `
          <CreateTimeFrom>${createTimeFrom}</CreateTimeFrom>
          <CreateTimeTo>${createTimeTo}</CreateTimeTo>
          <OrderRole>Seller</OrderRole>
          <OrderStatus>All</OrderStatus>
          <Pagination>
            <EntriesPerPage>50</EntriesPerPage>
            <PageNumber>${pageNumber}</PageNumber>
          </Pagination>
        `,
      });

      const orderBlocks = xmlBlocks(xml, "Order");
      total += orderBlocks.length;

      for (const orderXml of orderBlocks) {
        // Debug: log first 500 chars of order XML
        console.log("Order XML preview:", orderXml.substring(0, 500));

        const orderId = xmlValue(orderXml, "OrderID") || "";
        const amountPaid = xmlValue(orderXml, "AmountPaid") || xmlValue(orderXml, "Total") || "0";
        const totalPrice = parseFloat(amountPaid);
        const currency = xmlAttr(orderXml, "AmountPaid", "currencyID") || xmlAttr(orderXml, "Total", "currencyID") || "EUR";
        const buyerUserId = xmlValue(orderXml, "BuyerUserID") || "";

        // Buyer info is nested in ShippingAddress
        const shippingBlock = xmlBlocks(orderXml, "ShippingAddress")[0] || "";
        const buyerName = xmlValue(shippingBlock, "Name") || "";
        const email = xmlValue(orderXml, "BuyerEmail") || xmlValue(orderXml, "Email") || "";

        let status = "pending";
        const orderStatus = xmlValue(orderXml, "OrderStatus") || "";
        const shippedTime = xmlValue(orderXml, "ShippedTime");
        if (orderStatus === "Completed" && shippedTime) status = "shipped";
        else if (orderStatus === "Completed") status = "pending";
        else if (orderStatus === "Cancelled") status = "cancelled";

        const buyerJson = { username: buyerUserId, email, name: buyerName };
        console.log(`Order ${orderId}: €${totalPrice} ${currency}, buyer=${buyerUserId}, name=${buyerName}, status=${orderStatus}`);

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

          // Insert order items (line items)
          if (newOrder) {
            const transactionBlocks = xmlBlocks(orderXml, "Transaction");
            for (const txXml of transactionBlocks) {
              const sku = xmlValue(txXml, "SKU") || null;
              const lineItemId = xmlValue(txXml, "OrderLineItemID") || null;
              const qty = parseInt(xmlValue(txXml, "QuantityPurchased") || "1");
              const itemPrice = parseFloat(xmlValue(txXml, "TransactionPrice") || "0");

              await supabase.from('order_items').insert({
                order_id: newOrder.id,
                seller_id: sellerId,
                sku,
                line_item_id: lineItemId,
                quantity: qty,
                price: itemPrice,
              });
            }
          }
          imported++;
        }
      }

      const totalPages = parseInt(xmlValue(xml, "TotalNumberOfPages") || "1");
      hasMore = pageNumber < totalPages;
      pageNumber++;
    }

    const message = `${imported} neu importiert, ${updated} aktualisiert (${total} gesamt)`;
    console.log(`Orders sync for ${sellerId}: ${message}`);

    return new Response(
      JSON.stringify({ success: true, message, imported, updated, total }),
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
