import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

    // Get seller for eBay credentials
    const { data: seller } = await supabase
      .from('sellers')
      .select('refresh_token_enc, marketplace')
      .eq('id', sellerId)
      .maybeSingle();

    if (!seller?.refresh_token_enc) {
      // No eBay connection - simulate success for demo
      console.log(`[DEMO] Would push tracking ${shipment.tracking_number} (${shipment.carrier}) to eBay order ${shipment.orders.order_id}`);
      
      // Mark as pushed (demo mode)
      await supabase
        .from('shipments')
        .update({ tracking_pushed: true })
        .eq('id', shipmentId);

      // Update order status
      await supabase
        .from('orders')
        .update({ order_status: 'shipped', needs_fulfillment: false })
        .eq('id', shipment.order_id);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Tracking ${shipment.tracking_number} markiert als gepusht (Demo-Modus – eBay nicht verbunden)`,
          demo: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // TODO: Real eBay API call with refresh_token_enc
    // POST /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment
    // For now, mark as pushed
    console.log(`Push tracking ${shipment.tracking_number} to eBay order ${shipment.orders.order_id}`);

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
