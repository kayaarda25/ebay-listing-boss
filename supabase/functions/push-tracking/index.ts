import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ebayTradingCall } from "../_shared/ebay-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

    const ebayOrderId = shipment.orders.order_id;

    // Use CompleteSale to push tracking info to eBay
    await ebayTradingCall({
      callName: "CompleteSale",
      body: `
        <OrderID>${ebayOrderId}</OrderID>
        <Shipment>
          <ShipmentTrackingDetails>
            <ShippingCarrierUsed>${shipment.carrier}</ShippingCarrierUsed>
            <ShipmentTrackingNumber>${shipment.tracking_number}</ShipmentTrackingNumber>
          </ShipmentTrackingDetails>
        </Shipment>
        <Shipped>true</Shipped>
      `,
    });

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
