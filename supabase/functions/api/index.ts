import { authenticateRequest, auditLog, corsHeaders, jsonResponse, errorResponse, ApiContext } from "../_shared/api-auth.ts";
import { getCJAccessToken, CJ_BASE } from "../_shared/cj-auth.ts";
import { ebayTradingCall, xmlValue, xmlValues, xmlBlocks } from "../_shared/ebay-auth.ts";

const VERSION = "1.0.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  
  // Strip the function prefix to get the API path
  // URL will be like /api/v1/health -> we want /v1/health
  const fullPath = url.pathname;
  const pathMatch = fullPath.match(/\/api(\/v1\/.*)/) || fullPath.match(/(\/v1\/.*)/);
  const path = pathMatch ? pathMatch[1] : fullPath.replace(/^\/api/, "") || "/";

  // Health endpoint is public
  if (path === "/v1/health" && req.method === "GET") {
    return jsonResponse({ ok: true, version: VERSION, timestamp: new Date().toISOString() });
  }

  // Authenticate
  const authResult = await authenticateRequest(req);
  if (authResult instanceof Response) return authResult;
  const ctx = authResult as ApiContext;

  let response: Response;
  try {
    response = await routeRequest(ctx, req, path);
  } catch (err) {
    console.error("API Error:", err);
    response = errorResponse(String(err), 500);
  }

  // Audit log (fire and forget)
  auditLog(ctx, req, response.status, startTime).catch(console.error);

  return response;
});

async function routeRequest(ctx: ApiContext, req: Request, path: string): Promise<Response> {
  const method = req.method;

  // === ORDERS ===
  if (path === "/v1/orders" && method === "GET") return handleGetOrders(ctx, req);
  if (path === "/v1/orders/sync" && method === "POST") return handleOrdersSync(ctx);
  
  // /v1/orders/:orderId/fulfill
  const fulfillMatch = path.match(/^\/v1\/orders\/([^/]+)\/fulfill$/);
  if (fulfillMatch && method === "POST") return handleFulfill(ctx, fulfillMatch[1]);

  // /v1/orders/:orderId/sync-tracking
  const trackingMatch = path.match(/^\/v1\/orders\/([^/]+)\/sync-tracking$/);
  if (trackingMatch && method === "POST") return handleSyncTracking(ctx, trackingMatch[1]);

  // === JOBS ===
  const jobMatch = path.match(/^\/v1\/jobs\/([^/]+)$/);
  if (jobMatch && method === "GET") return handleGetJob(ctx, jobMatch[1]);

  // === SKU MAP ===
  if (path === "/v1/sku-map" && method === "GET") return handleGetSkuMap(ctx);
  if (path === "/v1/sku-map" && method === "POST") return handleCreateSkuMap(ctx, req);
  const skuMapPatch = path.match(/^\/v1\/sku-map\/([^/]+)$/);
  if (skuMapPatch && method === "PATCH") return handlePatchSkuMap(ctx, skuMapPatch[1], req);

  // === LISTINGS ===
  if (path === "/v1/listings/prepare" && method === "POST") return handleListingsPrepare(ctx, req);
  if (path === "/v1/listings/publish" && method === "POST") return handleListingsPublish(ctx, req);

  // === API KEYS (admin) ===
  if (path === "/v1/api-keys" && method === "GET") return handleGetApiKeys(ctx);
  if (path === "/v1/api-keys" && method === "POST") return handleCreateApiKey(ctx, req);
  const keyPatch = path.match(/^\/v1\/api-keys\/([^/]+)$/);
  if (keyPatch && method === "PATCH") return handlePatchApiKey(ctx, keyPatch[1], req);

  return errorResponse("Not found", 404, "NOT_FOUND");
}

// ==================== ORDERS ====================

async function handleGetOrders(ctx: ApiContext, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "all";
  const sync = url.searchParams.get("sync") === "true";

  if (sync) {
    // Trigger sync job
    const job = await createJob(ctx, "orders_sync", {});
    // Execute inline for sync=true
    await executeOrdersSync(ctx);
  }

  let query = ctx.supabase
    .from("orders")
    .select("*, order_items(*), shipments(*)")
    .eq("seller_id", ctx.sellerId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (status === "awaiting_fulfillment") {
    query = query.eq("needs_fulfillment", true).in("order_status", ["pending", "processing"]);
  } else if (status === "fulfilled") {
    query = query.eq("order_status", "shipped");
  }

  const { data, error } = await query;
  if (error) return errorResponse(error.message, 500);

  return jsonResponse({ ok: true, orders: data, count: data?.length || 0 });
}

async function handleOrdersSync(ctx: ApiContext): Promise<Response> {
  const job = await createJob(ctx, "orders_sync", {});
  return jsonResponse({ ok: true, jobId: job.id, message: "Order sync job queued" });
}

async function executeOrdersSync(ctx: ApiContext): Promise<void> {
  // Fetch orders from eBay via Trading API GetOrders
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

  for (const orderXml of orderBlocks) {
    const orderId = xmlValue(orderXml, "OrderID");
    if (!orderId) continue;

    const buyerUserId = xmlValue(orderXml, "BuyerUserID") || "";
    const totalStr = xmlValue(orderXml, "Total") || "0";
    const total = parseFloat(totalStr);
    const orderStatus = xmlValue(orderXml, "OrderStatus") || "Active";
    const shippingName = xmlValue(orderXml, "Name") || "";
    const street1 = xmlValue(orderXml, "Street1") || "";
    const street2 = xmlValue(orderXml, "Street2") || "";
    const city = xmlValue(orderXml, "CityName") || "";
    const state = xmlValue(orderXml, "StateOrProvince") || "";
    const postalCode = xmlValue(orderXml, "PostalCode") || "";
    const country = xmlValue(orderXml, "Country") || "";
    const phone = xmlValue(orderXml, "Phone") || "";

    const statusMap: Record<string, string> = {
      Active: "pending",
      Completed: "completed",
      Cancelled: "cancelled",
      Shipped: "shipped",
    };

    const buyerJson = {
      name: buyerUserId,
      address: { street1, street2, city, state, postalCode, country, phone },
      items: [] as any[],
    };

    // Parse line items
    const transactionBlocks = xmlBlocks(orderXml, "Transaction");
    const orderItems: any[] = [];
    for (const txXml of transactionBlocks) {
      const lineItemId = xmlValue(txXml, "OrderLineItemID") || "";
      const sku = xmlValue(txXml, "SKU") || "";
      const title = xmlValue(txXml, "Title") || "";
      const qty = parseInt(xmlValue(txXml, "QuantityPurchased") || "1");
      const price = parseFloat(xmlValue(txXml, "TransactionPrice") || "0");

      buyerJson.items.push({ lineItemId, sku, title, qty, price, itemId: xmlValue(txXml, "ItemID") });
      orderItems.push({ lineItemId, sku, title, qty, price });
    }

    // Upsert order
    const { data: existing } = await ctx.supabase
      .from("orders")
      .select("id")
      .eq("order_id", orderId)
      .eq("seller_id", ctx.sellerId)
      .maybeSingle();

    if (existing) {
      await ctx.supabase.from("orders").update({
        order_status: statusMap[orderStatus] || "pending",
        total_price: total,
        buyer_json: buyerJson,
        last_synced_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      const { data: newOrder } = await ctx.supabase.from("orders").insert({
        order_id: orderId,
        seller_id: ctx.sellerId,
        order_status: statusMap[orderStatus] || "pending",
        total_price: total,
        buyer_json: buyerJson,
        needs_fulfillment: orderStatus === "Active" || orderStatus === "Completed",
        last_synced_at: new Date().toISOString(),
      }).select("id").single();

      if (newOrder) {
        for (const item of orderItems) {
          await ctx.supabase.from("order_items").insert({
            order_id: newOrder.id,
            seller_id: ctx.sellerId,
            line_item_id: item.lineItemId,
            sku: item.sku,
            quantity: item.qty,
            price: item.price,
          });
        }
      }
    }
  }
}

// ==================== FULFILLMENT ====================

async function handleFulfill(ctx: ApiContext, orderId: string): Promise<Response> {
  // Find order
  const { data: order } = await ctx.supabase
    .from("orders")
    .select("*, shipments(*)")
    .eq("id", orderId)
    .eq("seller_id", ctx.sellerId)
    .maybeSingle();

  if (!order) return errorResponse("Order not found", 404, "NOT_FOUND");

  // Idempotency: check if fulfillment already exists
  const existingShipment = order.shipments?.find((s: any) => s.tracking_number);
  if (existingShipment) {
    return jsonResponse({
      ok: true,
      message: "Order already fulfilled",
      fulfillment: { trackingNumber: existingShipment.tracking_number, carrier: existingShipment.carrier },
      idempotent: true,
    });
  }

  // Check buyer_json for CJ order
  const buyer = order.buyer_json as any;
  if (buyer?.cj_order_id) {
    return jsonResponse({
      ok: true,
      message: "CJ order already created",
      cjOrderId: buyer.cj_order_id,
      idempotent: true,
    });
  }

  // Create job for fulfillment
  const job = await createJob(ctx, "order_fulfill", { orderId });
  return jsonResponse({ ok: true, jobId: job.id, state: "queued", message: "Fulfillment job queued" });
}

// ==================== TRACKING ====================

async function handleSyncTracking(ctx: ApiContext, orderId: string): Promise<Response> {
  const { data: order } = await ctx.supabase
    .from("orders")
    .select("*, shipments(*)")
    .eq("id", orderId)
    .eq("seller_id", ctx.sellerId)
    .maybeSingle();

  if (!order) return errorResponse("Order not found", 404, "NOT_FOUND");

  const buyer = order.buyer_json as any;
  const cjOrderId = buyer?.cj_order_id;

  if (!cjOrderId) {
    return errorResponse("No CJ order ID found. Create CJ order first via /fulfill.", 422, "NO_CJ_ORDER");
  }

  // Get tracking from CJ
  const token = await getCJAccessToken();
  const res = await fetch(`${CJ_BASE}/shopping/order/getOrderDetail?orderId=${cjOrderId}`, {
    headers: { "CJ-Access-Token": token },
  });
  const data = await res.json();

  if (data.code !== 200) return errorResponse(`CJ query failed: ${data.message}`, 502);

  const cjOrder = data.data;
  const trackingNumber = cjOrder?.trackNumber || "";
  const carrier = cjOrder?.logisticName || "CJPacket";

  if (!trackingNumber) {
    return jsonResponse({ ok: true, updated: false, message: "CJ has no tracking yet" });
  }

  // Upsert shipment
  const existingShipment = order.shipments?.[0];
  if (existingShipment) {
    if (existingShipment.tracking_pushed) {
      return jsonResponse({
        ok: true, updated: false, message: "Tracking already pushed to eBay",
        trackingNumber: existingShipment.tracking_number, carrier: existingShipment.carrier,
      });
    }
    await ctx.supabase.from("shipments").update({ tracking_number: trackingNumber, carrier }).eq("id", existingShipment.id);
  } else {
    await ctx.supabase.from("shipments").insert({
      order_id: orderId, seller_id: ctx.sellerId, tracking_number: trackingNumber, carrier,
    });
  }

  // Push tracking to eBay
  try {
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

    // Mark as pushed
    const shipmentToUpdate = existingShipment?.id || (await ctx.supabase
      .from("shipments").select("id").eq("order_id", orderId).eq("seller_id", ctx.sellerId).maybeSingle()
    ).data?.id;

    if (shipmentToUpdate) {
      await ctx.supabase.from("shipments").update({ tracking_pushed: true }).eq("id", shipmentToUpdate);
    }

    await ctx.supabase.from("orders").update({
      order_status: "shipped", needs_fulfillment: false,
    }).eq("id", orderId);

    return jsonResponse({ ok: true, updated: true, trackingNumber, carrier, message: "Tracking pushed to eBay" });
  } catch (err) {
    return errorResponse(`Failed to push tracking to eBay: ${err}`, 502);
  }
}

// ==================== JOBS ====================

async function handleGetJob(ctx: ApiContext, jobId: string): Promise<Response> {
  const { data: job } = await ctx.supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("seller_id", ctx.sellerId)
    .maybeSingle();

  if (!job) return errorResponse("Job not found", 404, "NOT_FOUND");
  return jsonResponse({ ok: true, job });
}

async function createJob(ctx: ApiContext, type: string, input: any) {
  const { data, error } = await ctx.supabase
    .from("jobs")
    .insert({ seller_id: ctx.sellerId, type, input, state: "queued" })
    .select()
    .single();

  if (error) throw new Error(`Failed to create job: ${error.message}`);
  return data;
}

// ==================== SKU MAP ====================

async function handleGetSkuMap(ctx: ApiContext): Promise<Response> {
  const { data, error } = await ctx.supabase
    .from("sku_map")
    .select("*")
    .eq("seller_id", ctx.sellerId)
    .order("created_at", { ascending: false });

  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ ok: true, skuMap: data });
}

async function handleCreateSkuMap(ctx: ApiContext, req: Request): Promise<Response> {
  const body = await req.json();
  const { ebaySku, cjVariantId, defaultQty, minMarginPct, active } = body;

  if (!ebaySku || !cjVariantId) {
    return errorResponse("ebaySku and cjVariantId are required", 422, "VALIDATION_ERROR");
  }

  const { data, error } = await ctx.supabase
    .from("sku_map")
    .upsert({
      seller_id: ctx.sellerId,
      ebay_sku: ebaySku,
      cj_variant_id: cjVariantId,
      default_qty: defaultQty || 1,
      min_margin_pct: minMarginPct || 20,
      active: active !== false,
    }, { onConflict: "seller_id,ebay_sku" })
    .select()
    .single();

  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ ok: true, skuMap: data }, 201);
}

async function handlePatchSkuMap(ctx: ApiContext, id: string, req: Request): Promise<Response> {
  const body = await req.json();
  const updates: any = {};
  if (body.cjVariantId !== undefined) updates.cj_variant_id = body.cjVariantId;
  if (body.defaultQty !== undefined) updates.default_qty = body.defaultQty;
  if (body.minMarginPct !== undefined) updates.min_margin_pct = body.minMarginPct;
  if (body.active !== undefined) updates.active = body.active;

  const { data, error } = await ctx.supabase
    .from("sku_map")
    .update(updates)
    .eq("id", id)
    .eq("seller_id", ctx.sellerId)
    .select()
    .single();

  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ ok: true, skuMap: data });
}

// ==================== LISTINGS ====================

async function handleListingsPrepare(ctx: ApiContext, req: Request): Promise<Response> {
  const body = await req.json();
  const { source, cjVariantId } = body;

  if (source !== "cj" || !cjVariantId) {
    return errorResponse("source must be 'cj' and cjVariantId is required", 422, "VALIDATION_ERROR");
  }

  // Fetch product details from CJ
  const token = await getCJAccessToken();
  const res = await fetch(`${CJ_BASE}/product/variant/query`, {
    method: "POST",
    headers: { "CJ-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ vid: cjVariantId }),
  });
  const data = await res.json();

  if (data.code !== 200) return errorResponse(`CJ product query failed: ${data.message}`, 502);

  const product = data.data;

  // Store as source_product
  const { data: sourceProduct, error } = await ctx.supabase
    .from("source_products")
    .upsert({
      seller_id: ctx.sellerId,
      source_id: cjVariantId,
      source_type: "cjdropshipping",
      title: product?.productName || `CJ Product ${cjVariantId}`,
      description: product?.description || "",
      price_source: product?.sellPrice || 0,
      images_json: product?.productImage ? [product.productImage] : [],
      variants_json: product ? [{ vid: cjVariantId, name: product.variantName, price: product.sellPrice }] : [],
    }, { onConflict: "seller_id,source_id" })
    .select()
    .single();

  if (error) return errorResponse(error.message, 500);

  return jsonResponse({
    ok: true,
    draft: {
      sourceProductId: sourceProduct.id,
      title: sourceProduct.title,
      description: sourceProduct.description,
      sourcePrice: sourceProduct.price_source,
      images: sourceProduct.images_json,
    },
  });
}

async function handleListingsPublish(ctx: ApiContext, req: Request): Promise<Response> {
  const body = await req.json();
  const { sourceProductId, price, quantity, title, categoryId } = body;

  if (!sourceProductId || !price) {
    return errorResponse("sourceProductId and price are required", 422, "VALIDATION_ERROR");
  }

  // Get source product
  const { data: sp } = await ctx.supabase
    .from("source_products")
    .select("*")
    .eq("id", sourceProductId)
    .eq("seller_id", ctx.sellerId)
    .maybeSingle();

  if (!sp) return errorResponse("Source product not found", 404, "NOT_FOUND");

  const sku = sp.source_id;

  // Create inventory item + offer (reuse existing ebay-publish-offer logic)
  const { data: existingOffer } = await ctx.supabase
    .from("ebay_offers")
    .select("id")
    .eq("sku", sku)
    .eq("seller_id", ctx.sellerId)
    .maybeSingle();

  if (existingOffer) {
    return jsonResponse({ ok: true, message: "Listing already exists", offerId: existingOffer.id, idempotent: true });
  }

  // Create ebay_offer record
  const { data: offer, error } = await ctx.supabase
    .from("ebay_offers")
    .insert({
      seller_id: ctx.sellerId,
      sku,
      title: title || sp.title,
      price,
      quantity: quantity || 1,
      category_id: categoryId || null,
      state: "draft",
      source_url: sp.source_type === "cjdropshipping" ? `https://cjdropshipping.com` : null,
    })
    .select()
    .single();

  if (error) return errorResponse(error.message, 500);

  // Create job to publish via eBay API
  const job = await createJob(ctx, "listing_publish", { offerId: offer.id });

  return jsonResponse({
    ok: true,
    offerId: offer.id,
    jobId: job.id,
    message: "Listing created, publishing job queued",
  }, 201);
}

// ==================== API KEYS ====================

async function handleGetApiKeys(ctx: ApiContext): Promise<Response> {
  const { data, error } = await ctx.supabase
    .from("api_keys")
    .select("id, name, is_active, last_used_at, created_at")
    .eq("seller_id", ctx.sellerId)
    .order("created_at", { ascending: false });

  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ ok: true, apiKeys: data });
}

async function handleCreateApiKey(ctx: ApiContext, req: Request): Promise<Response> {
  const body = await req.json();
  const { name } = body;
  if (!name) return errorResponse("name is required", 422, "VALIDATION_ERROR");

  // Generate a random API key
  const rawKey = crypto.randomUUID() + "-" + crypto.randomUUID();

  // Hash it
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const { data, error } = await ctx.supabase
    .from("api_keys")
    .insert({ name, key_hash: keyHash, seller_id: ctx.sellerId })
    .select("id, name, created_at")
    .single();

  if (error) return errorResponse(error.message, 500);

  // Return the raw key ONCE - it cannot be retrieved later
  return jsonResponse({
    ok: true,
    apiKey: { ...data, key: rawKey },
    warning: "Store this key securely. It cannot be retrieved again.",
  }, 201);
}

async function handlePatchApiKey(ctx: ApiContext, id: string, req: Request): Promise<Response> {
  const body = await req.json();
  const updates: any = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.isActive !== undefined) updates.is_active = body.isActive;

  const { data, error } = await ctx.supabase
    .from("api_keys")
    .update(updates)
    .eq("id", id)
    .eq("seller_id", ctx.sellerId)
    .select("id, name, is_active, last_used_at, created_at")
    .single();

  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ ok: true, apiKey: data });
}
