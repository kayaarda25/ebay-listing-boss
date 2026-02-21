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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get all sellers with auto_sync_enabled
    const { data: sellers } = await supabase
      .from('sellers')
      .select('id, pricing_settings')
      .eq('is_active', true);

    if (!sellers || sellers.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'Keine aktiven Seller' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let synced = 0;
    for (const seller of sellers) {
      const settings = seller.pricing_settings as any || {};
      if (settings.auto_sync_enabled === false) continue;

      try {
        // Call sync-prices for each seller
        const response = await fetch(`${SUPABASE_URL}/functions/v1/sync-prices`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sellerId: seller.id }),
        });

        if (response.ok) {
          synced++;
          console.log(`Synced prices for seller ${seller.id}`);
        } else {
          console.warn(`Failed to sync seller ${seller.id}: ${response.status}`);
        }
      } catch (err) {
        console.warn(`Error syncing seller ${seller.id}:`, err);
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: `${synced}/${sellers.length} Seller synchronisiert` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Cron sync error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
