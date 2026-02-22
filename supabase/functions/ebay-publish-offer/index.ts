import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ebayTradingCall, xmlValue } from "../_shared/ebay-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sellerId, offerId, action } = await req.json();
    if (!sellerId || !offerId) {
      return new Response(JSON.stringify({ success: false, error: 'sellerId and offerId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: offer, error: offerError } = await supabase
      .from('ebay_offers')
      .select('*')
      .eq('id', offerId)
      .eq('seller_id', sellerId)
      .single();

    if (offerError || !offer) {
      return new Response(JSON.stringify({ success: false, error: 'Offer nicht gefunden' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: product } = await supabase
      .from('source_products')
      .select('*')
      .eq('seller_id', sellerId)
      .eq('source_id', offer.sku)
      .maybeSingle();

    if (action === "publish" || action === "create") {
      if (offer.listing_id) {
        // ReviseFixedPriceItem – update existing listing
        const xml = await ebayTradingCall({
          callName: "ReviseFixedPriceItem",
          body: `
            <Item>
              <ItemID>${offer.listing_id}</ItemID>
              <StartPrice>${offer.price || 0}</StartPrice>
              <Quantity>${offer.quantity || 1}</Quantity>
            </Item>
          `,
        });

        await supabase.from('ebay_offers').update({
          state: 'published',
          last_synced_at: new Date().toISOString(),
        }).eq('id', offerId);

        return new Response(
          JSON.stringify({ success: true, message: `Listing ${offer.listing_id} aktualisiert` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        // AddFixedPriceItem – create new listing
        const title = (product?.title || offer.sku).substring(0, 80);
        const description = product?.description || title;
        const images = (product?.images_json as string[]) || [];
        const pictureUrls = images.map(url => `<PictureURL>${url}</PictureURL>`).join("\n");

        const xml = await ebayTradingCall({
          callName: "AddFixedPriceItem",
          body: `
            <Item>
              <Title>${escapeXml(title)}</Title>
              <Description>${escapeXml(description)}</Description>
              <PrimaryCategory>
                <CategoryID>${offer.category_id || "175673"}</CategoryID>
              </PrimaryCategory>
              <StartPrice currencyID="EUR">${offer.price || 0}</StartPrice>
              <Quantity>${offer.quantity || 1}</Quantity>
              <ListingDuration>GTC</ListingDuration>
              <ListingType>FixedPriceItem</ListingType>
              <Country>DE</Country>
              <Currency>EUR</Currency>
              <ConditionID>1000</ConditionID>
              <SKU>${escapeXml(offer.sku)}</SKU>
              <PictureDetails>
                ${pictureUrls}
              </PictureDetails>
              <DispatchTimeMax>3</DispatchTimeMax>
            </Item>
          `,
        });

        const itemId = xmlValue(xml, "ItemID");

        await supabase.from('ebay_offers').update({
          listing_id: itemId,
          state: 'published',
          last_synced_at: new Date().toISOString(),
        }).eq('id', offerId);

        return new Response(
          JSON.stringify({ success: true, message: `Listing erstellt (${itemId})`, listingId: itemId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (action === "withdraw") {
      if (!offer.listing_id) {
        return new Response(JSON.stringify({ success: false, error: 'Kein Listing zum Beenden' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await ebayTradingCall({
        callName: "EndFixedPriceItem",
        body: `
          <ItemID>${offer.listing_id}</ItemID>
          <EndingReason>NotAvailable</EndingReason>
        `,
      });

      await supabase.from('ebay_offers').update({
        state: 'paused',
        last_synced_at: new Date().toISOString(),
      }).eq('id', offerId);

      return new Response(
        JSON.stringify({ success: true, message: 'Listing beendet' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
