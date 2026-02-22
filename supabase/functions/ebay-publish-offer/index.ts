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
    const { sellerId, offerId, action } = await req.json();
    if (!sellerId || !offerId) {
      return new Response(JSON.stringify({ success: false, error: 'sellerId and offerId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getEbayAccessToken();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get offer from DB
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

    // Get the source product for details
    const { data: product } = await supabase
      .from('source_products')
      .select('*')
      .eq('seller_id', sellerId)
      .eq('source_id', offer.sku)
      .maybeSingle();

    const marketplace = "EBAY_DE";

    if (action === "publish" || action === "create") {
      // Step 1: Create/Update Inventory Item
      const inventoryPayload: any = {
        availability: {
          shipToLocationAvailability: {
            quantity: offer.quantity || 1,
          },
        },
        condition: "NEW",
        product: {
          title: product?.title || offer.sku,
          description: product?.description || product?.title || offer.sku,
          imageUrls: (product?.images_json as string[]) || [],
        },
      };

      const invResponse = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${offer.sku}`, {
        method: "PUT",
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Language': 'de-DE',
        },
        body: JSON.stringify(inventoryPayload),
      });

      if (!invResponse.ok && invResponse.status !== 204) {
        const errText = await invResponse.text();
        throw new Error(`Inventory Item creation failed [${invResponse.status}]: ${errText}`);
      }
      // Consume body if 204
      if (invResponse.status !== 204) await invResponse.text();

      // Step 2: Create or update offer
      if (!offer.offer_id) {
        // Create new offer
        const offerPayload: any = {
          sku: offer.sku,
          marketplaceId: marketplace,
          format: "FIXED_PRICE",
          pricingSummary: {
            price: { value: String(offer.price || 0), currency: "EUR" },
          },
          availableQuantity: offer.quantity || 1,
          categoryId: offer.category_id || "175673", // Default eBay category
          listingDescription: product?.description || product?.title || "",
          merchantLocationKey: undefined,
        };

        if (offer.fulfillment_policy_id) offerPayload.listingPolicies = { ...offerPayload.listingPolicies, fulfillmentPolicyId: offer.fulfillment_policy_id };
        if (offer.payment_policy_id) offerPayload.listingPolicies = { ...offerPayload.listingPolicies, paymentPolicyId: offer.payment_policy_id };
        if (offer.return_policy_id) offerPayload.listingPolicies = { ...offerPayload.listingPolicies, returnPolicyId: offer.return_policy_id };

        const createResponse = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer`, {
          method: "POST",
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Content-Language': 'de-DE',
          },
          body: JSON.stringify(offerPayload),
        });

        const createData = await createResponse.json();
        if (!createResponse.ok) {
          throw new Error(`Offer creation failed [${createResponse.status}]: ${JSON.stringify(createData)}`);
        }

        const ebayOfferId = createData.offerId;

        // Step 3: Publish the offer
        const publishResponse = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${ebayOfferId}/publish`, {
          method: "POST",
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        });

        const publishData = await publishResponse.json();
        if (!publishResponse.ok) {
          throw new Error(`Publish failed [${publishResponse.status}]: ${JSON.stringify(publishData)}`);
        }

        // Update DB with offer_id and listing_id
        await supabase.from('ebay_offers').update({
          offer_id: ebayOfferId,
          listing_id: publishData.listingId || null,
          state: 'published',
          last_synced_at: new Date().toISOString(),
        }).eq('id', offerId);

        return new Response(
          JSON.stringify({ success: true, message: `Listing veröffentlicht (${publishData.listingId})`, listingId: publishData.listingId, offerId: ebayOfferId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        // Update existing offer price/quantity
        const updatePayload = {
          pricingSummary: {
            price: { value: String(offer.price || 0), currency: "EUR" },
          },
          availableQuantity: offer.quantity || 1,
        };

        const updateResponse = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${offer.offer_id}`, {
          method: "PUT",
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Content-Language': 'de-DE',
          },
          body: JSON.stringify(updatePayload),
        });

        if (!updateResponse.ok) {
          const errText = await updateResponse.text();
          throw new Error(`Offer update failed [${updateResponse.status}]: ${errText}`);
        }
        await updateResponse.text();

        await supabase.from('ebay_offers').update({
          state: 'published',
          last_synced_at: new Date().toISOString(),
        }).eq('id', offerId);

        return new Response(
          JSON.stringify({ success: true, message: 'Offer aktualisiert' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (action === "withdraw") {
      if (!offer.offer_id) {
        return new Response(JSON.stringify({ success: false, error: 'Kein Offer zum Zurückziehen' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const response = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${offer.offer_id}/withdraw`, {
        method: "POST",
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Withdraw failed [${response.status}]: ${errText}`);
      }
      await response.text();

      await supabase.from('ebay_offers').update({
        state: 'paused',
        last_synced_at: new Date().toISOString(),
      }).eq('id', offerId);

      return new Response(
        JSON.stringify({ success: true, message: 'Listing zurückgezogen' }),
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
