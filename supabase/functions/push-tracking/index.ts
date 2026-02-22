import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEbayAccessToken, EBAY_API_BASE } from "../_shared/ebay-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const CARRIER_MAP: Record<string, string> = {
  "DHL": "DHL",
  "DPD": "DPD",
  "Hermes": "Hermes",
  "GLS": "GLS",
  "UPS": "UPS",
  "FedEx": "FedEx",
  "Deutsche Post": "Deutsche_Post",
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { shipmentId, sellerId } = await req.json();

    if (!shipmentId || !sellerId) {
      return new Response(
        JSON.stringify({ success: false, error: 'shipmentId und sellerId sind erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get shipment with order details
    const { data: shipment, error: shipmentError } = await supabase
      .from('shipments')
      .select('*, orders!inner(order_id, seller_id)')
      .eq('id', shipmentId)
      .eq('seller_id', sellerId)
      .maybeSingle();

    if (shipmentError || !shipment) {
      return new Response(
        JSON.stringify({ success: false, error: 'Sendung nicht gefunden' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (shipment.tracking_pushed) {
      return new Response(
        JSON.stringify({ success: true, message: 'Tracking wurde bereits gepusht' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Push tracking to eBay via Fulfillment API
    const accessToken = await getEbayAccessToken();
    const ebayOrderId = shipment.orders.order_id;

    // Get line items from order_items
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('line_item_id, quantity')
      .eq('order_id', shipment.order_id)
      .eq('seller_id', sellerId);

    const lineItems = (orderItems || [])
      .filter(i => i.line_item_id)
      .map(i => ({ lineItemId: i.line_item_id, quantity: i.quantity }));

    const fulfillmentPayload: any = {
      trackingNumber: shipment.tracking_number,
      shippingCarrierCode: CARRIER_MAP[shipment.carrier] || shipment.carrier,
    };

    if (lineItems.length > 0) {
      fulfillmentPayload.lineItems = lineItems;
    }

    const response = await fetch(
      `${EBAY_API_BASE}/sell/fulfillment/v1/order/${ebayOrderId}/shipping_fulfillment`,
      {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fulfillmentPayload),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`eBay Fulfillment API [${response.status}]: ${errText}`);
    }
    await response.text();

    // Mark as pushed
    await supabase
      .from('shipments')
      .update({ tracking_pushed: true })
      .eq('id', shipmentId);

    await supabase
      .from('orders')
      .update({ order_status: 'shipped', needs_fulfillment: false })
      .eq('id', shipment.order_id);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Tracking ${shipment.tracking_number} (${shipment.carrier}) an eBay gepusht`,
      }),
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
