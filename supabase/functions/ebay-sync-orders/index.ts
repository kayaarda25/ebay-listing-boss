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

        // Buyer & shipping address
        const shippingBlock = xmlBlocks(orderXml, "ShippingAddress")[0] || "";
        const buyerName = xmlValue(shippingBlock, "Name") || "";
        const street1 = xmlValue(shippingBlock, "Street1") || "";
        const street2 = xmlValue(shippingBlock, "Street2") || "";
        const city = xmlValue(shippingBlock, "CityName") || "";
        const postalCode = xmlValue(shippingBlock, "PostalCode") || "";
        const country = xmlValue(shippingBlock, "CountryName") || xmlValue(shippingBlock, "Country") || "";
        const phone = xmlValue(shippingBlock, "Phone") || "";
        const email = xmlValue(orderXml, "BuyerEmail") || xmlValue(orderXml, "Email") || "";

        let status = "pending";
        const orderStatus = xmlValue(orderXml, "OrderStatus") || "";
        const shippedTime = xmlValue(orderXml, "ShippedTime");
        const paidTime = xmlValue(orderXml, "PaidTime");
        if (orderStatus === "Cancelled") status = "cancelled";
        else if (shippedTime) status = "shipped";
        else if (orderStatus === "Completed" || paidTime) status = "pending";

        // Extract item titles from transactions
        const transactionBlocks = xmlBlocks(orderXml, "Transaction");
        const items = transactionBlocks.map(tx => {
          const itemBlock = xmlBlocks(tx, "Item")[0] || tx;
          return {
            title: xmlValue(itemBlock, "Title") || "",
            itemId: xmlValue(itemBlock, "ItemID") || "",
            sku: xmlValue(tx, "SKU") || xmlValue(itemBlock, "SKU") || "",
            quantity: parseInt(xmlValue(tx, "QuantityPurchased") || "1"),
            price: parseFloat(xmlValue(tx, "TransactionPrice") || "0"),
            lineItemId: xmlValue(tx, "OrderLineItemID") || "",
          };
        });

        const buyerJson = {
          username: buyerUserId,
          email,
          name: buyerName,
          address: {
            street1, street2, city, postalCode, country, phone,
          },
          items: items.map(i => ({ title: i.title, itemId: i.itemId, sku: i.sku, quantity: i.quantity, price: i.price })),
        };
        console.log(`Order ${orderId}: €${totalPrice} ${currency}, buyer=${buyerUserId}, name=${buyerName}, items=${items.length}, status=${orderStatus}`);

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

          // Insert order items from pre-parsed items
          if (newOrder) {
            for (const item of items) {
              await supabase.from('order_items').insert({
                order_id: newOrder.id,
                seller_id: sellerId,
                sku: item.sku || null,
                line_item_id: item.lineItemId || null,
                quantity: item.quantity,
                price: item.price,
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

    // Auto-detect eBay User ID from the first order's SellerID field
    if (total > 0) {
      const firstOrder = xmlBlocks(xml, "Order")[0] || "";
      const sellerUserId = xmlValue(firstOrder, "SellerUserID") || xmlValue(firstOrder, "SellerID") || "";
      if (sellerUserId) {
        const { data: currentSeller } = await supabase
          .from('sellers')
          .select('ebay_user_id')
          .eq('id', sellerId)
          .maybeSingle();
        if (currentSeller && !currentSeller.ebay_user_id) {
          await supabase.from('sellers').update({ ebay_user_id: sellerUserId }).eq('id', sellerId);
          console.log(`Set ebay_user_id to ${sellerUserId} for seller ${sellerId}`);
        }
      }
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
