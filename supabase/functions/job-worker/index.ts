import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCJAccessToken, CJ_BASE } from "../_shared/cj-auth.ts";
import { ebayTradingCall } from "../_shared/ebay-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Job Worker - processes queued jobs from the jobs table.
 * Designed to be called via cron (every minute) or manually.
 * Processes up to 5 jobs per invocation.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Pick up to 5 queued jobs that are ready to run
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("state", "queued")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    console.error("Failed to fetch jobs:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ===== AUTOPILOT CONTINUOUS MODE =====
  // Check all sellers with autopilot_active and queue their workflows
  try {
    const { data: activeSellers } = await supabase
      .from("sellers")
      .select("id, pricing_settings")
      .eq("is_active", true);

    for (const seller of activeSellers || []) {
      const settings = seller.pricing_settings as any;
      if (!settings?.autopilot_active) continue;

      const lastRun = settings.autopilot_last_run ? new Date(settings.autopilot_last_run).getTime() : 0;
      const intervalMs = (settings.autopilot_interval_min || 5) * 60 * 1000;
      
      if (Date.now() - lastRun < intervalMs) continue;

      // Queue a single autopilot_cycle job that runs all workflows sequentially and generates a report
      const { data: existingCycle } = await supabase
        .from("jobs")
        .select("id")
        .eq("seller_id", seller.id)
        .eq("type", "autopilot_cycle")
        .in("state", ["queued", "running"])
        .maybeSingle();

      if (!existingCycle) {
        await supabase.from("jobs").insert({
          seller_id: seller.id,
          type: "autopilot_cycle",
          input: { workflows: settings.autopilot_workflows || ["discovery", "listings", "order_sync", "fulfillment", "tracking", "optimize"], auto: true },
          state: "queued",
        });
      }

      // Update last run timestamp
      await supabase.from("sellers").update({
        pricing_settings: { ...settings, autopilot_last_run: new Date().toISOString() },
      }).eq("id", seller.id);
    }
  } catch (err) {
    console.error("Autopilot scheduler error:", err);
  }

  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];

  for (const job of jobs) {
    // Mark as running
    await supabase.from("jobs").update({ state: "running", attempts: job.attempts + 1 }).eq("id", job.id);

    try {
      let output: any;

      switch (job.type) {
        case "orders_sync":
        case "autopilot_order_sync":
          output = await processOrdersSync(supabase, job);
          break;
        case "order_fulfill":
        case "autopilot_fulfillment":
          output = await processOrderFulfill(supabase, job);
          break;
        case "tracking_sync":
        case "autopilot_tracking":
          output = await processTrackingSync(supabase, job);
          break;
        case "listing_publish":
        case "autopilot_listings":
          output = await processListingPublish(supabase, job);
          break;
        case "autopilot_discovery":
          output = await processAutopilotDiscovery(supabase, job);
          break;
        case "autopilot_optimize":
          output = await processAutopilotOptimize(supabase, job);
          break;
        case "autopilot_cycle":
          output = await processAutopilotCycle(supabase, job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      await supabase.from("jobs").update({ state: "done", output }).eq("id", job.id);
      results.push({ id: job.id, state: "done" });
    } catch (err) {
      console.error(`Job ${job.id} (${job.type}) failed:`, err);

      const newAttempts = job.attempts + 1;
      if (newAttempts >= job.max_attempts) {
        await supabase.from("jobs").update({
          state: "failed", error: String(err),
        }).eq("id", job.id);
        results.push({ id: job.id, state: "failed", error: String(err) });
      } else {
        // Exponential backoff: 30s, 120s, 480s
        const backoffMs = 30_000 * Math.pow(4, newAttempts - 1);
        const runAfter = new Date(Date.now() + backoffMs).toISOString();
        await supabase.from("jobs").update({
          state: "queued", error: String(err), run_after: runAfter,
        }).eq("id", job.id);
        results.push({ id: job.id, state: "retrying", nextRun: runAfter });
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// ==================== JOB HANDLERS ====================

async function processOrdersSync(supabase: any, job: any): Promise<any> {
  // Import the sync logic inline - uses the same eBay Trading API
  const { xmlBlocks, xmlValue } = await import("../_shared/ebay-auth.ts");

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const xml = await ebayTradingCall({
    callName: "GetOrders",
    body: `
      <CreateTimeFrom>${thirtyDaysAgo.toISOString()}</CreateTimeFrom>
      <CreateTimeTo>${now.toISOString()}</CreateTimeTo>
      <OrderRole>Seller</OrderRole>
      <OrderStatus>All</OrderStatus>
      <Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
    `,
  });

  const orderBlocks = xmlBlocks(xml, "Order");
  let synced = 0;

  for (const orderXml of orderBlocks) {
    const orderId = xmlValue(orderXml, "OrderID");
    if (!orderId) continue;

    const totalStr = xmlValue(orderXml, "Total") || "0";
    const orderStatus = xmlValue(orderXml, "OrderStatus") || "Active";
    const buyerUserId = xmlValue(orderXml, "BuyerUserID") || "";

    const statusMap: Record<string, string> = {
      Active: "pending", Completed: "completed", Cancelled: "cancelled", Shipped: "shipped",
    };

    const buyerJson = {
      name: buyerUserId,
      address: {
        street1: xmlValue(orderXml, "Street1") || "",
        street2: xmlValue(orderXml, "Street2") || "",
        city: xmlValue(orderXml, "CityName") || "",
        state: xmlValue(orderXml, "StateOrProvince") || "",
        postalCode: xmlValue(orderXml, "PostalCode") || "",
        country: xmlValue(orderXml, "Country") || "",
        phone: xmlValue(orderXml, "Phone") || "",
      },
      items: [] as any[],
    };

    const transactionBlocks = xmlBlocks(orderXml, "Transaction");
    const items: any[] = [];
    for (const tx of transactionBlocks) {
      const item = {
        lineItemId: xmlValue(tx, "OrderLineItemID") || "",
        sku: xmlValue(tx, "SKU") || "",
        title: xmlValue(tx, "Title") || "",
        qty: parseInt(xmlValue(tx, "QuantityPurchased") || "1"),
        price: parseFloat(xmlValue(tx, "TransactionPrice") || "0"),
      };
      buyerJson.items.push(item);
      items.push(item);
    }

    const { data: existing } = await supabase
      .from("orders").select("id").eq("order_id", orderId).eq("seller_id", job.seller_id).maybeSingle();

    if (existing) {
      await supabase.from("orders").update({
        order_status: statusMap[orderStatus] || "pending",
        total_price: parseFloat(totalStr), buyer_json: buyerJson,
        last_synced_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      const { data: newOrder } = await supabase.from("orders").insert({
        order_id: orderId, seller_id: job.seller_id,
        order_status: statusMap[orderStatus] || "pending",
        total_price: parseFloat(totalStr), buyer_json: buyerJson,
        needs_fulfillment: ["Active", "Completed"].includes(orderStatus),
        last_synced_at: new Date().toISOString(),
      }).select("id").single();

      if (newOrder) {
        for (const item of items) {
          await supabase.from("order_items").insert({
            order_id: newOrder.id, seller_id: job.seller_id,
            line_item_id: item.lineItemId, sku: item.sku,
            quantity: item.qty, price: item.price,
          });
        }
      }
    }
    synced++;
  }

  return { synced, total: orderBlocks.length };
}

async function processOrderFulfill(supabase: any, job: any): Promise<any> {
  const { orderId } = job.input;

  const { data: order } = await supabase
    .from("orders").select("*, order_items(*)").eq("id", orderId).eq("seller_id", job.seller_id).maybeSingle();

  if (!order) throw new Error("Order not found");

  const buyer = order.buyer_json as any;
  if (buyer?.cj_order_id) return { message: "Already fulfilled", cjOrderId: buyer.cj_order_id };

  // Collect SKUs from order items AND buyer_json items
  const orderItemSkus = (order.order_items || []).map((i: any) => i.sku).filter(Boolean);
  const buyerItems = buyer?.items || [];
  const buyerSkus = buyerItems.map((i: any) => i.sku).filter(Boolean);
  const allSkus = [...new Set([...orderItemSkus, ...buyerSkus])];

  // Path 1: Direct SKU map lookup
  let skuMaps: any[] = [];
  if (allSkus.length > 0) {
    const { data } = await supabase
      .from("sku_map").select("*").eq("seller_id", job.seller_id).in("ebay_sku", allSkus).eq("active", true);
    if (data) skuMaps = data;
  }

  // Path 2: If no direct match, resolve via ebay_inventory_items → source_products → variants
  if (skuMaps.length === 0 && allSkus.length > 0) {
    console.log("No direct SKU map match, trying inventory item → source product path for SKUs:", allSkus);
    
    const { data: invItems } = await supabase
      .from("ebay_inventory_items")
      .select("sku, source_product_id")
      .eq("seller_id", job.seller_id)
      .in("sku", allSkus)
      .not("source_product_id", "is", null);

    if (invItems && invItems.length > 0) {
      const spIds = invItems.map((i: any) => i.source_product_id).filter(Boolean);
      const { data: sourceProds } = await supabase
        .from("source_products")
        .select("id, source_id, variants_json, source_type")
        .eq("seller_id", job.seller_id)
        .eq("source_type", "cjdropshipping")
        .in("id", spIds);

      if (sourceProds && sourceProds.length > 0) {
        // Build synthetic sku_map entries from source product variants
        for (const sp of sourceProds) {
          const variants = (sp.variants_json || []) as any[];
          const firstVariant = variants[0];
          const vid = firstVariant?.vid || sp.source_id;
          // Find which order SKU maps to this source product
          const linkedInvItem = invItems.find((i: any) => i.source_product_id === sp.id);
          skuMaps.push({
            ebay_sku: linkedInvItem?.sku || "",
            cj_variant_id: vid,
            default_qty: 1,
          });
        }
        console.log("Resolved CJ variants via source products:", skuMaps.map((m: any) => m.cj_variant_id));
      }
    }
  }

  if (skuMaps.length === 0) {
    throw new Error(`No SKU mappings found for SKUs: ${allSkus.join(", ")}. Link products or create SKU mappings.`);
  }

  const address = buyer?.address || {};
  const token = await getCJAccessToken();

  const products = skuMaps.map((m: any) => {
    const orderItem = (order.order_items || []).find((i: any) => i.sku === m.ebay_sku) 
      || buyerItems.find((i: any) => i.sku === m.ebay_sku);
    return { vid: m.cj_variant_id, quantity: orderItem?.quantity || orderItem?.qty || m.default_qty || 1 };
  });

  const cjPayload = {
    orderNumber: order.order_id,
    shippingZip: address.postalCode || "",
    shippingCountryCode: (address.country?.length === 2 ? address.country : "DE"),
    shippingCountry: address.country || "Germany",
    shippingProvince: address.state || address.city || "",
    shippingCity: address.city || "",
    shippingAddress: [address.street1, address.street2].filter(Boolean).join(", "),
    shippingCustomerName: buyer?.name || "",
    shippingPhone: address.phone || "",
    remark: `eBay Order ${order.order_id}`,
    products,
  };

  const res = await fetch(`${CJ_BASE}/shopping/order/createOrderV2`, {
    method: "POST",
    headers: { "CJ-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify(cjPayload),
  });

  const data = await res.json();
  if (data.code !== 200) throw new Error(`CJ Order failed: ${data.message}`);

  const cjOrderId = data.data?.orderId || data.data?.orderNum || "";

  await supabase.from("orders").update({
    order_status: "processing",
    buyer_json: { ...buyer, cj_order_id: cjOrderId },
  }).eq("id", orderId);

  return { cjOrderId, message: "CJ order created" };
}

async function processTrackingSync(supabase: any, job: any): Promise<any> {
  const { orderId } = job.input;

  const { data: order } = await supabase
    .from("orders").select("*, shipments(*)").eq("id", orderId).eq("seller_id", job.seller_id).maybeSingle();

  if (!order) throw new Error("Order not found");

  const buyer = order.buyer_json as any;
  const cjOrderId = buyer?.cj_order_id;
  if (!cjOrderId) throw new Error("No CJ order ID found");

  const token = await getCJAccessToken();
  const res = await fetch(`${CJ_BASE}/shopping/order/getOrderDetail?orderId=${cjOrderId}`, {
    headers: { "CJ-Access-Token": token },
  });
  const data = await res.json();
  if (data.code !== 200) throw new Error(`CJ query failed: ${data.message}`);

  const trackingNumber = data.data?.trackNumber || "";
  const carrier = data.data?.logisticName || "CJPacket";

  if (!trackingNumber) return { updated: false, message: "No tracking yet" };

  // Upsert shipment
  const existing = order.shipments?.[0];
  if (existing) {
    await supabase.from("shipments").update({ tracking_number: trackingNumber, carrier }).eq("id", existing.id);
  } else {
    await supabase.from("shipments").insert({
      order_id: orderId, seller_id: job.seller_id, tracking_number: trackingNumber, carrier,
    });
  }

  // Push to eBay
  await ebayTradingCall({
    callName: "CompleteSale",
    body: `
      <OrderID>${order.order_id}</OrderID>
      <Shipment>
        <ShipmentTrackingDetails>
          <ShippingCarrierUsed>${carrier}</ShippingCarrierUsed>
          <ShipmentTrackingNumber>${trackingNumber}</ShipmentTrackingNumber>
        </ShipmentTrackingDetails>
      </Shipment>
      <Shipped>true</Shipped>
    `,
  });

  // Update shipment + order
  const shipId = existing?.id || (await supabase
    .from("shipments").select("id").eq("order_id", orderId).maybeSingle()
  ).data?.id;
  if (shipId) await supabase.from("shipments").update({ tracking_pushed: true }).eq("id", shipId);
  await supabase.from("orders").update({ order_status: "shipped", needs_fulfillment: false }).eq("id", orderId);

  return { updated: true, trackingNumber, carrier };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function processListingPublish(supabase: any, job: any): Promise<any> {
  const { offerId } = job.input;

  const { data: offer } = await supabase
    .from("ebay_offers").select("*").eq("id", offerId).eq("seller_id", job.seller_id).maybeSingle();

  if (!offer) throw new Error("Offer not found");
  if (offer.listing_id) return { message: "Already published", listingId: offer.listing_id };

  // Get source product for images/description
  const { data: sp } = await supabase
    .from("source_products").select("*").eq("source_id", offer.sku).eq("seller_id", job.seller_id).maybeSingle();

  const images = (sp?.images_json as string[]) || [];
  const description = sp?.description || offer.title || "";
  const pictureXml = images.map((url: string) => `<PictureURL>${escapeXml(url)}</PictureURL>`).join("\n");

  // Escape title for XML (description goes into CDATA so it's safe)
  const safeTitle = escapeXml((offer.title || "").substring(0, 80));
  const safeSku = escapeXml(offer.sku || "");

  const xml = await ebayTradingCall({
    callName: "AddFixedPriceItem",
    body: `
      <Item>
        <Title>${safeTitle}</Title>
        <Description><![CDATA[${description}]]></Description>
        <PrimaryCategory><CategoryID>${offer.category_id || "175673"}</CategoryID></PrimaryCategory>
        <StartPrice currencyID="EUR">${offer.price}</StartPrice>
        <Quantity>${offer.quantity || 1}</Quantity>
        <ListingDuration>GTC</ListingDuration>
        <ListingType>FixedPriceItem</ListingType>
        <Country>DE</Country>
        <Currency>EUR</Currency>
        <Site>Germany</Site>
        <SKU>${safeSku}</SKU>
        <PictureDetails>${pictureXml}</PictureDetails>
        <ConditionID>1000</ConditionID>
        <DispatchTimeMax>3</DispatchTimeMax>
      </Item>
    `,
  });

  const { xmlValue: xv } = await import("../_shared/ebay-auth.ts");
  const itemId = xv(xml, "ItemID");

  if (itemId) {
    await supabase.from("ebay_offers").update({
      listing_id: itemId, state: "published",
    }).eq("id", offerId);
  }

  return { listingId: itemId, message: "Published to eBay" };
}

async function processAutopilotDiscovery(supabase: any, job: any): Promise<any> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  
  const res = await fetch(`${supabaseUrl}/functions/v1/product-discovery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      sellerId: job.seller_id,
      maxProducts: 20,
    }),
  });
  const data = await res.json();
  return { discovered: data.discovered || 0, imported: data.imported || 0 };
}

async function processAutopilotOptimize(supabase: any, job: any): Promise<any> {
  // Deactivate stale listings (>14 days, no sales)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  
  const { data: staleListings } = await supabase
    .from("ebay_offers")
    .select("id, sku")
    .eq("seller_id", job.seller_id)
    .in("state", ["published", "active"])
    .lte("created_at", fourteenDaysAgo)
    .limit(50);

  if (!staleListings || staleListings.length === 0) return { deactivated: 0 };

  const staleSKUs = staleListings.map((l: any) => l.sku);
  const { data: orderItems } = await supabase
    .from("order_items")
    .select("sku")
    .eq("seller_id", job.seller_id)
    .in("sku", staleSKUs);

  const skusWithSales = new Set((orderItems || []).map((oi: any) => oi.sku));
  let deactivated = 0;
  for (const listing of staleListings) {
    if (!skusWithSales.has(listing.sku)) {
      await supabase.from("ebay_offers").update({ state: "paused" }).eq("id", listing.id);
      deactivated++;
    }
  }
  return { checked: staleListings.length, deactivated };
}

// ==================== AUTOPILOT CYCLE WITH REPORT ====================

async function processAutopilotCycle(supabase: any, job: any): Promise<any> {
  const sellerId = job.seller_id;
  const workflows: string[] = job.input?.workflows || ["discovery", "listings", "order_sync", "fulfillment", "tracking", "optimize"];
  
  const reportDetails: { icon: string; text: string }[] = [];
  const stats: Record<string, number> = {};
  const errors: string[] = [];

  // 1. DISCOVERY
  if (workflows.includes("discovery")) {
    try {
      const result = await processAutopilotDiscovery(supabase, job);
      const discovered = result.discovered || 0;
      const imported = result.imported || 0;
      stats.entdeckt = discovered;
      stats.importiert = imported;
      if (discovered > 0) {
        reportDetails.push({ icon: "discovery", text: `${discovered} neue Produkte entdeckt, ${imported} importiert` });
      } else {
        reportDetails.push({ icon: "info", text: "Keine neuen Produkte gefunden" });
      }
    } catch (err) {
      errors.push(`Discovery: ${String(err)}`);
      reportDetails.push({ icon: "error", text: `Discovery fehlgeschlagen: ${String(err).substring(0, 100)}` });
    }
  }

  // 2. AUTO-LIST new draft offers
  if (workflows.includes("listings")) {
    try {
      const { data: drafts } = await supabase
        .from("ebay_offers")
        .select("id, title, sku")
        .eq("seller_id", sellerId)
        .eq("state", "draft")
        .is("listing_id", null)
        .limit(10);

      let listed = 0;
      let listErrors = 0;
      for (const draft of drafts || []) {
        try {
          await processListingPublish(supabase, { ...job, input: { offerId: draft.id } });
          listed++;
          reportDetails.push({ icon: "listing", text: `Listing erstellt: ${(draft.title || draft.sku).substring(0, 60)}` });
        } catch (err) {
          listErrors++;
          const errMsg = String(err);
          // Don't fail entire cycle for payment-hold warnings
          if (errMsg.includes("einbehalten") || errMsg.includes("pending-payments")) {
            reportDetails.push({ icon: "error", text: `Listing blockiert (Zahlungseinbehaltung): ${(draft.title || draft.sku).substring(0, 40)}` });
          } else {
            reportDetails.push({ icon: "error", text: `Listing Fehler: ${errMsg.substring(0, 80)}` });
          }
        }
      }
      stats.gelistet = listed;
      if (listErrors > 0) stats.listing_fehler = listErrors;
    } catch (err) {
      errors.push(`Listings: ${String(err)}`);
    }
  }

  // 3. ORDER SYNC
  if (workflows.includes("order_sync")) {
    try {
      const result = await processOrdersSync(supabase, job);
      stats.orders_synced = result.synced || 0;
      if (result.synced > 0) {
        reportDetails.push({ icon: "order", text: `${result.synced} Bestellungen synchronisiert` });
      }
    } catch (err) {
      errors.push(`Order Sync: ${String(err)}`);
      reportDetails.push({ icon: "error", text: `Order-Sync fehlgeschlagen: ${String(err).substring(0, 80)}` });
    }
  }

  // 4. FULFILLMENT - auto-fulfill pending orders with SKU mappings
  if (workflows.includes("fulfillment")) {
    try {
      const { data: pendingOrders } = await supabase
        .from("orders")
        .select("id, order_id")
        .eq("seller_id", sellerId)
        .eq("needs_fulfillment", true)
        .in("order_status", ["pending", "processing", "completed"])
        .limit(10);

      let fulfilled = 0;
      for (const order of pendingOrders || []) {
        try {
          await processOrderFulfill(supabase, { ...job, input: { orderId: order.id } });
          fulfilled++;
          reportDetails.push({ icon: "fulfillment", text: `Order ${order.order_id} fulfilled` });
        } catch (fulfillErr) {
          console.error(`Fulfillment failed for ${order.order_id}:`, String(fulfillErr));
          reportDetails.push({ icon: "error", text: `Fulfillment ${order.order_id}: ${String(fulfillErr).substring(0, 80)}` });
        }
      }
      stats.fulfilled = fulfilled;
    } catch (err) {
      errors.push(`Fulfillment: ${String(err)}`);
    }
  }

  // 5. TRACKING
  if (workflows.includes("tracking")) {
    try {
      const { data: processingOrders } = await supabase
        .from("orders")
        .select("id, order_id")
        .eq("seller_id", sellerId)
        .eq("order_status", "processing")
        .limit(20);

      let tracked = 0;
      for (const order of processingOrders || []) {
        try {
          const result = await processTrackingSync(supabase, { ...job, input: { orderId: order.id } });
          if (result.updated) {
            tracked++;
            reportDetails.push({ icon: "tracking", text: `Tracking für Order ${order.order_id}: ${result.trackingNumber}` });
          }
        } catch {
          // Skip orders without CJ order ID
        }
      }
      if (tracked > 0) stats.tracking = tracked;
    } catch (err) {
      errors.push(`Tracking: ${String(err)}`);
    }
  }

  // 6. OPTIMIZE
  if (workflows.includes("optimize")) {
    try {
      const result = await processAutopilotOptimize(supabase, job);
      if (result.deactivated > 0) {
        stats.deaktiviert = result.deactivated;
        reportDetails.push({ icon: "optimize", text: `${result.deactivated} inaktive Listings pausiert` });
      }
    } catch (err) {
      errors.push(`Optimize: ${String(err)}`);
    }
  }

  // Build human summary
  const parts: string[] = [];
  if (stats.entdeckt) parts.push(`${stats.entdeckt} Produkte entdeckt`);
  if (stats.gelistet) parts.push(`${stats.gelistet} gelistet`);
  if (stats.orders_synced) parts.push(`${stats.orders_synced} Orders synchronisiert`);
  if (stats.fulfilled) parts.push(`${stats.fulfilled} Orders fulfilled`);
  if (stats.tracking) parts.push(`${stats.tracking} Trackings aktualisiert`);
  if (stats.deaktiviert) parts.push(`${stats.deaktiviert} Listings pausiert`);
  if (errors.length > 0) parts.push(`${errors.length} Fehler`);

  const summary = parts.length > 0
    ? `Autopilot-Zyklus: ${parts.join(", ")}`
    : "Autopilot-Zyklus: Keine Änderungen";

  // Write report
  await supabase.from("autopilot_reports").insert({
    seller_id: sellerId,
    report_type: "cycle",
    summary,
    details: reportDetails,
    stats,
  });

  return { summary, stats, errors };
}
