import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ebayTradingCall, xmlBlocks, xmlValue } from "../_shared/ebay-auth.ts";
import { getCJAccessToken, CJ_BASE } from "../_shared/cj-auth.ts";

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

    const product = await loadSourceProduct(supabase, sellerId, offer.sku);

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
        const dbImages = normalizeImageUrls(product?.images_json);
        const cjFallback = dbImages.length === 0 ? await fetchCjProductBySku(offer.sku) : null;

        const title = (product?.title || offer.title || cjFallback?.title || offer.sku).substring(0, 80);
        const description = product?.description || cjFallback?.description || title;
        const images = [
          ...dbImages,
          ...normalizeImageUrls(cjFallback?.images),
        ]
          .filter((url, index, arr) => url.startsWith('http') && arr.indexOf(url) === index)
          .slice(0, 12);

        if (images.length === 0) {
          return new Response(
            JSON.stringify({
              success: false,
              error: `Keine Produktbilder vorhanden (SKU: ${offer.sku}). Bitte Produkt neu importieren oder Bilder in source_products.images_json hinterlegen.`,
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

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

/** Verify listing – always includes ConditionID to avoid spurious errors */
async function verifyAuctionListing(params: PublishAuctionListingParams): Promise<string> {
  return ebayTradingCall({
    callName: "VerifyAddItem",
    body: buildAuctionItemBody({ ...params, conditionId: params.conditionId || "1000" }),
  });
}

/** Check if an eBay error is specifically about the category being invalid */
function isCategoryError(message: string): boolean {
  const categoryPatterns = [
    "Unterkategorie",
    "Kategorie ist nicht gültig",
    "Ungültige Kategorie",
    "nicht um eine so genannte Unterkategorie",
    "nicht gültig. Bitte wählen Sie eine andere Kategorie",
  ];
  return categoryPatterns.some(p => message.includes(p));
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
  // Build candidate list: preferred → keyword-suggested → known-good leaf categories
  const suggested = suggestCategoryId(title);
  const candidates = [preferredCategoryId, suggested, "175673", "20710", "1281", "26395"]
    .filter((v): v is string => Boolean(v));
  const uniqueCandidates = [...new Set(candidates)];

  console.log(`Category resolution for "${title}" – candidates: ${uniqueCandidates.join(", ")}`);

  for (const candidateCategoryId of uniqueCandidates) {
    try {
      await verifyAuctionListing({
        title, description, categoryId: candidateCategoryId, price, sku, pictureUrls, itemSpecifics,
      });
      console.log(`Category ${candidateCategoryId} verified OK`);
      return candidateCategoryId;
    } catch (error) {
      const message = String(error);

      // Only reject if the error is specifically about the category
      if (!isCategoryError(message)) {
        // Non-category error (photos, condition, payment hold, etc.) → category is valid
        console.log(`Category ${candidateCategoryId} accepted (non-category errors ignored)`);
        return candidateCategoryId;
      }

      console.warn(`Category ${candidateCategoryId} rejected (category error), trying leaf lookup...`);

      // Try finding a leaf child
      if (message.includes("Unterkategorie")) {
        const leafCategoryId = await findLeafCategoryFromParent(candidateCategoryId);
        if (leafCategoryId) {
          console.log(`Found leaf category ${leafCategoryId} from parent ${candidateCategoryId}`);
          return leafCategoryId; // Accept without re-verifying – leaf from eBay is valid
        }
      }
    }
  }

  // Last resort: try findAnyLeafCategoryId
  console.warn("All candidates failed, trying global leaf lookup...");
  const fallbackLeafCategoryId = await findAnyLeafCategoryId();
  if (fallbackLeafCategoryId) {
    console.log(`Using global fallback leaf category: ${fallbackLeafCategoryId}`);
    return fallbackLeafCategoryId;
  }

  return null;
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
  const specs: Record<string, string> = { Marke: "Markenlos", Produktart: "Allgemein", Herstellernummer: "Nicht zutreffend", ...attributes };

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

async function loadSourceProduct(supabase: any, sellerId: string, sku: string): Promise<Record<string, any> | null> {
  const bySource = await supabase
    .from('source_products')
    .select('*')
    .eq('seller_id', sellerId)
    .eq('source_id', sku)
    .maybeSingle();

  if (bySource?.data) return bySource.data;

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sku)) {
    const byId = await supabase
      .from('source_products')
      .select('*')
      .eq('seller_id', sellerId)
      .eq('id', sku)
      .maybeSingle();

    if (byId?.data) return byId.data;
  }

  return null;
}

function normalizeImageUrls(raw: unknown): string[] {
  const urls: string[] = [];

  const collect = (value: unknown) => {
    if (value == null) return;

    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return;

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          collect(JSON.parse(trimmed));
          return;
        } catch {
          // Keep processing as plain string
        }
      }

      const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
      if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
        urls.push(normalized);
      }
      return;
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      collect(obj.url);
      collect(obj.image);
      collect(obj.imageUrl);
      collect(obj.src);
      collect(obj.mainImage);
      collect(obj.images);
    }
  };

  collect(raw);
  return [...new Set(urls)];
}

async function fetchCjProductBySku(sku: string): Promise<{ title?: string | null; description?: string | null; images?: unknown } | null> {
  if (!/^\d{10,}$/.test(sku)) return null;

  try {
    const token = await getCJAccessToken();
    const res = await fetch(`${CJ_BASE}/product/query?pid=${encodeURIComponent(sku)}`, {
      headers: { 'CJ-Access-Token': token },
    });

    if (!res.ok) return null;

    const payload = await res.json();
    const detail = payload?.data;
    if (payload?.code !== 200 || !detail) return null;

    const images = normalizeImageUrls([
      detail.productImage,
      detail.productImages,
      detail.image,
      detail.images,
      detail.bigImage,
      detail.bigImages,
      detail.productImageList,
    ]);

    if (images.length === 0) return null;

    return {
      title: detail.productName || detail.name || null,
      description: detail.description || detail.productDesc || null,
      images,
    };
  } catch (error) {
    console.warn(`CJ fallback failed for SKU ${sku}:`, String(error));
    return null;
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

