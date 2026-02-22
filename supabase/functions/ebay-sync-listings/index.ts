import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ebayTradingCall, xmlValue, xmlValues, xmlBlocks } from "../_shared/ebay-auth.ts";

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

    let pageNumber = 1;
    let hasMore = true;
    let imported = 0;
    let updated = 0;
    let total = 0;

    while (hasMore) {
      const xml = await ebayTradingCall({
        callName: "GetSellerList",
        body: `
          <StartTimeFrom>${new Date(Date.now() - 120 * 86400000).toISOString()}</StartTimeFrom>
          <StartTimeTo>${new Date().toISOString()}</StartTimeTo>
          <IncludeVariations>true</IncludeVariations>
          <GranularityLevel>Fine</GranularityLevel>
          <Pagination>
            <EntriesPerPage>100</EntriesPerPage>
            <PageNumber>${pageNumber}</PageNumber>
          </Pagination>
        `,
      });

      const itemBlocks = xmlBlocks(xml, "Item");
      total += itemBlocks.length;

      for (const itemXml of itemBlocks) {
        const itemId = xmlValue(itemXml, "ItemID") || "";
        const sku = xmlValue(itemXml, "SKU") || itemId;
        const title = xmlValue(itemXml, "Title") || "";
        const currentPrice = parseFloat(xmlValue(itemXml, "CurrentPrice") || xmlValue(itemXml, "ConvertedCurrentPrice") || "0");
        const quantity = parseInt(xmlValue(itemXml, "Quantity") || "0");
        const quantitySold = parseInt(xmlValue(itemXml, "QuantitySold") || "0");
        const remainingQty = quantity - quantitySold;
        const listingStatus = xmlValue(itemXml, "SellingStatus") ? xmlValue(xmlBlocks(itemXml, "SellingStatus")[0] || "", "ListingStatus") : null;
        const categoryId = xmlValue(itemXml, "PrimaryCategoryID") || xmlValue(xmlBlocks(itemXml, "PrimaryCategory")[0] || "", "CategoryID") || null;

        let state = "active";
        if (listingStatus === "Completed" || listingStatus === "Ended") state = "paused";
        else if (listingStatus === "Active") state = "active";

        console.log(`Item ${itemId}: ${title.substring(0, 50)}, €${currentPrice}, qty=${remainingQty}, status=${listingStatus}`);

        // Upsert into ebay_offers by seller_id + sku
        const { data: existing } = await supabase
          .from('ebay_offers')
          .select('id')
          .eq('seller_id', sellerId)
          .eq('sku', sku)
          .maybeSingle();

        if (existing) {
          await supabase.from('ebay_offers').update({
            title,
            price: currentPrice,
            quantity: remainingQty,
            state,
            listing_id: itemId,
            category_id: categoryId,
            last_synced_at: new Date().toISOString(),
          }).eq('id', existing.id);
          updated++;
        } else {
          await supabase.from('ebay_offers').insert({
            seller_id: sellerId,
            sku,
            title,
            price: currentPrice,
            quantity: remainingQty,
            state,
            listing_id: itemId,
            category_id: categoryId,
            last_synced_at: new Date().toISOString(),
          });
          imported++;
        }
      }

      const totalPages = parseInt(xmlValue(xml, "TotalNumberOfPages") || "1");
      hasMore = pageNumber < totalPages;
      pageNumber++;
    }

    const message = `${imported} neu importiert, ${updated} aktualisiert (${total} gesamt)`;
    console.log(`Listings sync for ${sellerId}: ${message}`);

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
