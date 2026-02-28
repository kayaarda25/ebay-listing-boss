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
          output = await processOrdersSync(supabase, job);
          break;
        case "order_fulfill":
          output = await processOrderFulfill(supabase, job);
          break;
        case "tracking_sync":
          output = await processTrackingSync(supabase, job);
          break;
        case "listing_publish":
          output = await processListingPublish(supabase, job);
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

  // Look up SKU mappings
  const skus = (order.order_items || []).map((i: any) => i.sku).filter(Boolean);
  const { data: skuMaps } = await supabase
    .from("sku_map").select("*").eq("seller_id", job.seller_id).in("ebay_sku", skus).eq("active", true);

  if (!skuMaps || skuMaps.length === 0) {
    throw new Error(`No SKU mappings found for SKUs: ${skus.join(", ")}. Create them via POST /v1/sku-map first.`);
  }

  const address = buyer?.address || {};
  const token = await getCJAccessToken();

  const products = skuMaps.map((m: any) => {
    const orderItem = order.order_items.find((i: any) => i.sku === m.ebay_sku);
    return { vid: m.cj_variant_id, quantity: orderItem?.quantity || m.default_qty };
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
  const pictureXml = images.map((url: string) => `<PictureURL>${url}</PictureURL>`).join("\n");

  const xml = await ebayTradingCall({
    callName: "AddFixedPriceItem",
    body: `
      <Item>
        <Title>${(offer.title || "").substring(0, 80)}</Title>
        <Description><![CDATA[${description}]]></Description>
        <PrimaryCategory><CategoryID>${offer.category_id || "175673"}</CategoryID></PrimaryCategory>
        <StartPrice currencyID="EUR">${offer.price}</StartPrice>
        <Quantity>${offer.quantity || 1}</Quantity>
        <ListingDuration>GTC</ListingDuration>
        <ListingType>FixedPriceItem</ListingType>
        <Country>DE</Country>
        <Currency>EUR</Currency>
        <Site>Germany</Site>
        <SKU>${offer.sku}</SKU>
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
