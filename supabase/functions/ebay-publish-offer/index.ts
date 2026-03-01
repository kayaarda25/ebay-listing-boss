import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ebayTradingCall, xmlBlocks, xmlValue } from "../_shared/ebay-auth.ts";

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
        // ReviseItem – update existing listing
        const xml = await ebayTradingCall({
          callName: "ReviseItem",
          body: `
            <Item>
              <ItemID>${offer.listing_id}</ItemID>
              <StartPrice currencyID="EUR">${offer.price || 0}</StartPrice>
              <Quantity>1</Quantity>
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
        // AddItem – Auktion, da Festpreis für neue Seller oft nicht erlaubt
        const title = (product?.title || offer.sku).substring(0, 80);
        const description = product?.description || title;
        const rawImages = (product?.images_json as string[]) || [];
        const images = rawImages
          .filter(url => url && typeof url === 'string' && url.startsWith('http'))
          .slice(0, 12);
        const pictureUrls = images.map(url => `<PictureURL>${escapeXml(url)}</PictureURL>`).join("\n");

        // Build item specifics from product attributes
        const attributes = (product?.attributes_json as Record<string, string>) || {};
        const itemSpecifics = buildItemSpecifics(attributes);

        const categoryId = await resolveValidCategoryId({
          preferredCategoryId: offer.category_id,
          title,
          description,
          price: offer.price || 0,
          sku: offer.sku,
          pictureUrls,
          itemSpecifics,
        });

        if (!categoryId) {
          return new Response(
            JSON.stringify({ success: false, error: 'Keine gültige eBay-Kategorie gefunden. Bitte Kategorie manuell setzen.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const xml = await publishAuctionListing({
          title,
          description,
          categoryId,
          price: offer.price || 0,
          sku: offer.sku,
          pictureUrls,
          itemSpecifics,
        });

        const itemId = xmlValue(xml, "ItemID");

        if (!itemId) {
          return new Response(
            JSON.stringify({
              success: false,
              code: "EBAY_NO_ITEM_CREATED",
              error: "eBay hat das Listing nicht erstellt. Prüfe dein eBay-Konto auf Einschränkungen.",
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        await supabase.from('ebay_offers').update({
          listing_id: itemId,
          category_id: categoryId,
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
        callName: "EndItem",
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
    const errorMessage = String(error);
    console.error('Error:', error);

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

interface PublishAuctionListingParams {
  title: string;
  description: string;
  categoryId: string;
  price: number;
  sku: string;
  pictureUrls: string;
  itemSpecifics: string;
  conditionId?: string | null;
}

interface ResolveCategoryParams {
  preferredCategoryId?: string | null;
  title: string;
  description: string;
  price: number;
  sku: string;
  pictureUrls: string;
  itemSpecifics: string;
}

function buildAuctionItemBody({
  title,
  description,
  categoryId,
  price,
  sku,
  pictureUrls,
  itemSpecifics,
  conditionId,
}: PublishAuctionListingParams): string {
  return `
    <Item>
      <Title>${escapeXml(title)}</Title>
      <Description><![CDATA[${description}]]></Description>
      <PrimaryCategory>
        <CategoryID>${categoryId}</CategoryID>
      </PrimaryCategory>
      <StartPrice currencyID="EUR">${price}</StartPrice>
      <Quantity>1</Quantity>
      <ListingDuration>Days_7</ListingDuration>
      <ListingType>Chinese</ListingType>
      <Country>DE</Country>
      <Currency>EUR</Currency>
      <Location>Deutschland</Location>
      <SKU>${escapeXml(sku)}</SKU>
      ${conditionId ? `<ConditionID>${conditionId}</ConditionID>` : ""}
      <PictureDetails>
        ${pictureUrls}
      </PictureDetails>
      <DispatchTimeMax>3</DispatchTimeMax>
      <ShippingDetails>
        <ShippingType>Flat</ShippingType>
        <ShippingServiceOptions>
          <ShippingServicePriority>1</ShippingServicePriority>
          <ShippingService>DE_DHLPaket</ShippingService>
          <ShippingServiceCost currencyID="EUR">0.00</ShippingServiceCost>
          <ShippingServiceAdditionalCost currencyID="EUR">0.00</ShippingServiceAdditionalCost>
          <FreeShipping>true</FreeShipping>
        </ShippingServiceOptions>
      </ShippingDetails>
      <ReturnPolicy>
        <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
        <ReturnsWithinOption>Days_30</ReturnsWithinOption>
        <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
      </ReturnPolicy>
      ${itemSpecifics}
    </Item>
  `;
}

async function publishAuctionListing(params: PublishAuctionListingParams): Promise<string> {
  try {
    return await ebayTradingCall({
      callName: "AddItem",
      body: buildAuctionItemBody(params),
    });
  } catch (error) {
    const message = String(error);
    const needsCondition = message.includes("Artikelzustand ist für diese Kategorie erforderlich");

    if (!needsCondition || params.conditionId) {
      throw error;
    }

    return ebayTradingCall({
      callName: "AddItem",
      body: buildAuctionItemBody({ ...params, conditionId: "1000" }),
    });
  }
}

async function verifyAuctionListing(params: PublishAuctionListingParams): Promise<string> {
  return ebayTradingCall({
    callName: "VerifyAddItem",
    body: buildAuctionItemBody(params),
  });
}

async function findLeafCategoryFromParent(parentCategoryId: string): Promise<string | null> {
  try {
    const xml = await ebayTradingCall({
      callName: "GetCategories",
      body: `
        <CategorySiteID>77</CategorySiteID>
        <CategoryParent>${parentCategoryId}</CategoryParent>
        <DetailLevel>ReturnAll</DetailLevel>
        <LevelLimit>2</LevelLimit>
        <ViewAllNodes>true</ViewAllNodes>
      `,
    });

    const categoryBlocks = xmlBlocks(xml, "Category");
    for (const block of categoryBlocks) {
      const id = xmlValue(block, "CategoryID");
      const isLeaf = xmlValue(block, "LeafCategory")?.toLowerCase() === "true";
      if (id && id !== parentCategoryId && isLeaf) {
        return id;
      }
    }

    return null;
  } catch (error) {
    console.warn(`GetCategories failed for parent ${parentCategoryId}:`, String(error));
    return null;
  }
}

async function findAnyLeafCategoryId(): Promise<string | null> {
  try {
    const xml = await ebayTradingCall({
      callName: "GetCategories",
      body: `
        <CategorySiteID>77</CategorySiteID>
        <DetailLevel>ReturnAll</DetailLevel>
        <LevelLimit>6</LevelLimit>
        <ViewAllNodes>true</ViewAllNodes>
      `,
    });

    const categoryBlocks = xmlBlocks(xml, "Category");
    for (const block of categoryBlocks) {
      const id = xmlValue(block, "CategoryID");
      const isLeaf = xmlValue(block, "LeafCategory")?.toLowerCase() === "true";
      if (id && isLeaf) {
        return id;
      }
    }

    return null;
  } catch (error) {
    console.warn("GetCategories fallback lookup failed:", String(error));
    return null;
  }
}

async function resolveValidCategoryId({
  preferredCategoryId,
  title,
  description,
  price,
  sku,
  pictureUrls,
  itemSpecifics,
}: ResolveCategoryParams): Promise<string | null> {
  const candidates = [preferredCategoryId, "175673", suggestCategoryId(title)]
    .filter((v): v is string => Boolean(v));

  const uniqueCandidates = [...new Set(candidates)];

  for (const candidateCategoryId of uniqueCandidates) {
    try {
      await verifyAuctionListing({
        title,
        description,
        categoryId: candidateCategoryId,
        price,
        sku,
        pictureUrls,
        itemSpecifics,
      });
      return candidateCategoryId;
    } catch (error) {
      const message = String(error);

      if (message.includes("Unterkategorie")) {
        const leafCategoryId = await findLeafCategoryFromParent(candidateCategoryId);
        if (!leafCategoryId) continue;

        try {
          await verifyAuctionListing({
            title,
            description,
            categoryId: leafCategoryId,
            price,
            sku,
            pictureUrls,
            itemSpecifics,
          });
          return leafCategoryId;
        } catch (leafError) {
          const leafMessage = String(leafError);
          if (leafMessage.includes("Kategorie ist nicht gültig") || leafMessage.includes("Unterkategorie")) {
            continue;
          }
          return leafCategoryId;
        }
      }

      if (message.includes("Kategorie ist nicht gültig")) {
        console.warn(`Category ${candidateCategoryId} invalid, trying next`);
        continue;
      }

      // Category likely valid; proceed with this one and let AddItem return concrete validation errors if any.
      return candidateCategoryId;
    }
  }

  const fallbackLeafCategoryId = await findAnyLeafCategoryId();
  if (!fallbackLeafCategoryId) {
    return null;
  }

  try {
    await verifyAuctionListing({
      title,
      description,
      categoryId: fallbackLeafCategoryId,
      price,
      sku,
      pictureUrls,
      itemSpecifics,
    });
    return fallbackLeafCategoryId;
  } catch {
    return null;
  }
}

/** Keyword-based category mapping for eBay.de leaf categories.
 *  Returns a best-guess leaf category ID based on product title keywords. */
function suggestCategoryId(title: string): string {
  const t = title.toLowerCase();

  const categoryMap: [RegExp, string][] = [
    // Electronics & Tech
    [/laptop|notebook|computer|pc|desktop/, "177"],        // Notebooks & Netbooks
    [/tablet|ipad/, "171485"],                              // Tablets & eBook-Reader
    [/handy|smartphone|iphone|samsung galaxy/, "9355"],     // Handys & Smartphones
    [/kopfhörer|headphone|earbuds|headset/, "112529"],      // Kopfhörer
    [/kamera|camera|gopro/, "31388"],                        // Digitalkameras
    [/fernseher|tv|monitor|bildschirm/, "11071"],           // Fernseher
    [/drucker|printer/, "171941"],                           // Drucker
    [/tastatur|keyboard|maus|mouse/, "33963"],              // Tastaturen & Keypads
    [/lautsprecher|speaker|bluetooth.?speaker/, "112529"],  // Lautsprecher
    [/usb|kabel|adapter|charger|ladegerät/, "67279"],       // Kabel & Adapter

    // Home & Garden
    [/lampe|licht|led|beleuchtung|ceiling|light/, "20710"], // Lampen & Licht
    [/möbel|schrank|regal|tisch|stuhl|chair|desk|hocker|stool/, "38221"], // Möbel
    [/garten|garden|pflanz|outdoor/, "159912"],             // Garten & Terrasse
    [/küche|kitchen|kochtopf|pfanne/, "20625"],             // Kochen & Genießen
    [/bad|bathroom|dusch|waschbecken/, "20599"],            // Badausstattung
    [/bettwäsche|kissen|pillow|mattress|matratze/, "20469"],// Bettwäsche

    // Fashion
    [/kleidung|shirt|hose|jacke|mantel|dress|pullover/, "15724"], // Herrenbekleidung
    [/schuh|shoe|sneaker|stiefel|boot/, "93427"],           // Herrenschuhe
    [/uhr|watch/, "31387"],                                  // Armbanduhren
    [/tasche|bag|rucksack|backpack/, "169291"],             // Reiseaccessoires

    // Sport
    [/sport|fitness|training|yoga|gym/, "888"],             // Fitness & Jogging
    [/fahrrad|bike|cycling/, "7294"],                        // Radsport
    [/camping|zelt|tent|wandern|hiking/, "16034"],          // Camping & Outdoor

    // Toys & Hobby
    [/spielzeug|toy|lego|playmobil/, "220"],                // Spielzeug
    [/puzzle/, "2613"],                                      // Puzzles
    [/modell|model.?kit|rc.?car/, "2562"],                  // Modellbau

    // Pet
    [/hund|dog|katze|cat|haustier|pet|reptil|terrarium/, "1281"], // Tierbedarf

    // Health & Beauty
    [/kosmetik|beauty|makeup|pflege|creme|shampoo|wax/, "26395"], // Gesundheit & Beauty
    [/massage|wellness/, "36624"],                          // Massage

    // Auto
    [/auto|car|kfz|fahrzeug|reifen|felge/, "10063"],       // Auto-Ersatzteile

    // Tools
    [/werkzeug|tool|bohrer|schrauber|drill/, "631"],        // Werkzeuge
    [/taschenlampe|flashlight|torch/, "631"],               // Werkzeuge
  ];

  for (const [pattern, categoryId] of categoryMap) {
    if (pattern.test(t)) {
      return categoryId;
    }
  }

  // Ultimate fallback: "Sonstige" under "Haushaltsgeräte" – valid leaf for auctions on eBay.de
  return "20710";
}

/** Build <ItemSpecifics> XML from product attributes.
 *  Always includes "Marke" = "Unbranded" as fallback. */
function buildItemSpecifics(attributes: Record<string, string>): string {
  const specs: Record<string, string> = { Marke: "Markenlos", ...attributes };

  const nameValues = Object.entries(specs)
    .filter(([_, v]) => v != null && typeof v !== 'object' && String(v).trim())
    .map(([name, value]) => `
      <NameValueList>
        <Name>${escapeXml(String(name))}</Name>
        <Value>${escapeXml(String(value).substring(0, 65))}</Value>
      </NameValueList>`)
    .join("");

  if (!nameValues) return "";
  return `<ItemSpecifics>${nameValues}</ItemSpecifics>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
