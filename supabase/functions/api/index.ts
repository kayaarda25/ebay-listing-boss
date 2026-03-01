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

  // === PRODUCTS (CJ Search) ===
  if (path === "/v1/products/search" && method === "GET") return handleProductSearch(ctx, req);
  const productDetailMatch = path.match(/^\/v1\/products\/([^/]+)$/);
  if (productDetailMatch && method === "GET") return handleProductDetail(ctx, productDetailMatch[1]);
  if (path === "/v1/products/freight" && method === "POST") return handleFreightCalc(ctx, req);

  // === LISTINGS ===
  if (path === "/v1/listings/prepare" && method === "POST") return handleListingsPrepare(ctx, req);
  if (path === "/v1/listings/publish" && method === "POST") return handleListingsPublish(ctx, req);

  // === API KEYS (admin) ===
  if (path === "/v1/api-keys" && method === "GET") return handleGetApiKeys(ctx);
  if (path === "/v1/api-keys" && method === "POST") return handleCreateApiKey(ctx, req);
  const keyPatch = path.match(/^\/v1\/api-keys\/([^/]+)$/);
  if (keyPatch && method === "PATCH") return handlePatchApiKey(ctx, keyPatch[1], req);

  // === AUTOPILOT ===
  if (path === "/v1/autopilot/run" && method === "POST") return handleAutopilotRun(ctx, req);
  if (path === "/v1/autopilot/status" && method === "GET") return handleAutopilotStatus(ctx);

  // === DISCOVERY ===
  if (path === "/v1/discovery/run" && method === "POST") return handleDiscoveryRun(ctx, req);
  if (path === "/v1/discovery/status" && method === "GET") return handleDiscoveryStatus(ctx);

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

// ==================== PRODUCTS (CJ Search) ====================

async function handleProductSearch(ctx: ApiContext, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const query = url.searchParams.get("q");
  const pageNum = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("limit") || "20");
  const countryCode = url.searchParams.get("country") || undefined;
  const categoryId = url.searchParams.get("category") || undefined;

  if (!query) return errorResponse("Query parameter 'q' is required", 422, "VALIDATION_ERROR");

  const token = await getCJAccessToken();
  const searchUrl = new URL(`${CJ_BASE}/product/list`);
  searchUrl.searchParams.set("productNameEn", query);
  searchUrl.searchParams.set("pageNum", String(pageNum));
  searchUrl.searchParams.set("pageSize", String(pageSize));
  if (countryCode && countryCode !== "all") searchUrl.searchParams.set("countryCode", countryCode);
  if (categoryId) searchUrl.searchParams.set("categoryId", categoryId);

  const res = await fetch(searchUrl.toString(), { headers: { "CJ-Access-Token": token } });
  const data = await res.json();
  if (data.code !== 200) return errorResponse(`CJ search failed: ${data.message}`, 502);

  const products = (data.data?.list || []).filter((p: any) => {
    if (!p.sellPrice && !p.productPrice) return false;
    if (p.productStatus && p.productStatus !== "VALID" && p.productStatus !== "ON_SALE") return false;
    if (!p.productImage && (!p.productImageSet || p.productImageSet.length === 0)) return false;
    return true;
  });

  return jsonResponse({
    ok: true,
    products: products.map((p: any) => ({
      pid: p.pid,
      name: p.productNameEn,
      image: p.productImage,
      price: p.sellPrice || p.productPrice,
      category: p.categoryName,
      variants: p.variantCount || 0,
    })),
    total: data.data?.total || 0,
    page: pageNum,
    limit: pageSize,
  });
}

async function handleProductDetail(ctx: ApiContext, productId: string): Promise<Response> {
  const token = await getCJAccessToken();
  const res = await fetch(`${CJ_BASE}/product/query?pid=${productId}`, {
    headers: { "CJ-Access-Token": token },
  });
  const data = await res.json();
  if (data.code !== 200) return errorResponse(`CJ product query failed: ${data.message}`, 502);

  const p = data.data;
  return jsonResponse({
    ok: true,
    product: {
      pid: p.pid,
      name: p.productNameEn,
      description: p.description,
      image: p.productImage,
      images: p.productImageSet || [],
      price: p.sellPrice,
      weight: p.productWeight,
      variants: (p.variants || []).map((v: any) => ({
        vid: v.vid,
        name: v.variantNameEn,
        price: v.variantSellPrice || v.variantPrice,
        image: v.variantImage,
        stock: v.variantVolume,
      })),
    },
  });
}

async function handleFreightCalc(ctx: ApiContext, req: Request): Promise<Response> {
  const body = await req.json();
  const { vid, countryCode = "DE", quantity = 1 } = body;
  if (!vid) return errorResponse("vid is required", 422, "VALIDATION_ERROR");

  const token = await getCJAccessToken();
  const res = await fetch(`${CJ_BASE}/logistic/freightCalculate`, {
    method: "POST",
    headers: { "CJ-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ endCountryCode: countryCode, products: [{ quantity, vid }] }),
  });
  const data = await res.json();

  return jsonResponse({
    ok: true,
    freight: (data.data || []).map((f: any) => ({
      logisticName: f.logisticName,
      estimatedDays: f.logisticAging,
      cost: f.logisticPrice,
      currency: f.logisticPriceCurrency || "USD",
    })),
  });
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

// ==================== AUTOPILOT ====================

async function handleAutopilotRun(ctx: ApiContext, req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const workflows = body.workflows || ["order_sync", "fulfillment", "tracking", "listings", "discovery"];
  const listingTarget = body.listingTarget || 100;
  
  const results: any = { startedAt: new Date().toISOString(), workflows: {} };

  // 1. ORDER SYNC
  if (workflows.includes("order_sync")) {
    try {
      await executeOrdersSync(ctx);
      results.workflows.order_sync = { status: "completed" };
    } catch (err) {
      results.workflows.order_sync = { status: "error", error: String(err) };
    }
  }

  // 2. FULFILLMENT - process all awaiting orders
  if (workflows.includes("fulfillment")) {
    try {
      const { data: awaitingOrders } = await ctx.supabase
        .from("orders")
        .select("id")
        .eq("seller_id", ctx.sellerId)
        .eq("needs_fulfillment", true)
        .in("order_status", ["pending", "processing"])
        .limit(20);

      const fulfilled: string[] = [];
      const errors: string[] = [];
      for (const order of awaitingOrders || []) {
        try {
          await createJob(ctx, "order_fulfill", { orderId: order.id });
          fulfilled.push(order.id);
        } catch (err) {
          errors.push(`${order.id}: ${err}`);
        }
      }
      results.workflows.fulfillment = { status: "completed", queued: fulfilled.length, errors: errors.length };
    } catch (err) {
      results.workflows.fulfillment = { status: "error", error: String(err) };
    }
  }

  // 3. TRACKING SYNC - for orders with CJ order IDs but no tracking pushed
  if (workflows.includes("tracking")) {
    try {
      const { data: trackingOrders } = await ctx.supabase
        .from("orders")
        .select("id, buyer_json, shipments(*)")
        .eq("seller_id", ctx.sellerId)
        .eq("order_status", "processing")
        .limit(20);

      let synced = 0;
      for (const order of trackingOrders || []) {
        const buyer = order.buyer_json as any;
        if (!buyer?.cj_order_id) continue;
        const hasUnpushed = !order.shipments?.length || order.shipments.some((s: any) => !s.tracking_pushed);
        if (hasUnpushed) {
          await createJob(ctx, "tracking_sync", { orderId: order.id });
          synced++;
        }
      }
      results.workflows.tracking = { status: "completed", queued: synced };
    } catch (err) {
      results.workflows.tracking = { status: "error", error: String(err) };
    }
  }

  // 4. LISTING AUTOMATION
  if (workflows.includes("listings")) {
    try {
      // Count listings created today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count: todayCount } = await ctx.supabase
        .from("ebay_offers")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", ctx.sellerId)
        .gte("created_at", todayStart.toISOString());

      const remaining = Math.max(0, listingTarget - (todayCount || 0));
      
      // Publish unpublished draft offers
      if (remaining > 0) {
        const { data: drafts } = await ctx.supabase
          .from("ebay_offers")
          .select("id")
          .eq("seller_id", ctx.sellerId)
          .eq("state", "draft")
          .is("listing_id", null)
          .limit(remaining);

        for (const draft of drafts || []) {
          await createJob(ctx, "listing_publish", { offerId: draft.id });
        }
        results.workflows.listings = { 
          status: "completed", 
          todayCount: todayCount || 0, 
          target: listingTarget, 
          newJobsQueued: drafts?.length || 0 
        };
      } else {
        results.workflows.listings = { 
          status: "target_reached", 
          todayCount: todayCount || 0, 
          target: listingTarget 
        };
      }
    } catch (err) {
      results.workflows.listings = { status: "error", error: String(err) };
    }
  }

  // 5. PRODUCT DISCOVERY
  if (workflows.includes("discovery")) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      
      const res = await fetch(`${supabaseUrl}/functions/v1/product-discovery`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          sellerId: ctx.sellerId,
          maxProducts: 20,
        }),
      });
      const discData = await res.json();
      results.workflows.discovery = {
        status: discData.ok ? "completed" : "error",
        discovered: discData.discovered || 0,
        imported: discData.imported || 0,
        error: discData.error,
      };
    } catch (err) {
      results.workflows.discovery = { status: "error", error: String(err) };
    }
  }

  results.completedAt = new Date().toISOString();
  return jsonResponse({ ok: true, autopilot: results });
}

async function handleAutopilotStatus(ctx: ApiContext): Promise<Response> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  // Parallel queries for dashboard stats
  const [
    awaitingRes,
    fulfilledTodayRes,
    listingsTodayRes,
    recentJobsRes,
    totalListingsRes,
    totalOrdersRes,
  ] = await Promise.all([
    ctx.supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", ctx.sellerId)
      .eq("needs_fulfillment", true)
      .in("order_status", ["pending", "processing"]),
    ctx.supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", ctx.sellerId)
      .eq("order_status", "shipped")
      .gte("updated_at", todayISO),
    ctx.supabase
      .from("ebay_offers")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", ctx.sellerId)
      .gte("created_at", todayISO),
    ctx.supabase
      .from("jobs")
      .select("id, type, state, error, created_at, updated_at")
      .eq("seller_id", ctx.sellerId)
      .order("created_at", { ascending: false })
      .limit(20),
    ctx.supabase
      .from("ebay_offers")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", ctx.sellerId)
      .in("state", ["published", "active"]),
    ctx.supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", ctx.sellerId),
  ]);

  return jsonResponse({
    ok: true,
    status: {
      ordersAwaitingFulfillment: awaitingRes.count || 0,
      ordersFulfilledToday: fulfilledTodayRes.count || 0,
      listingsCreatedToday: listingsTodayRes.count || 0,
      totalActiveListings: totalListingsRes.count || 0,
      totalOrders: totalOrdersRes.count || 0,
      recentJobs: recentJobsRes.data || [],
      apiHealth: "online",
      timestamp: new Date().toISOString(),
    },
  });
}

// ==================== DISCOVERY ====================

async function handleDiscoveryRun(ctx: ApiContext, req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  
  // Call the product-discovery edge function
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  
  const res = await fetch(`${supabaseUrl}/functions/v1/product-discovery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      sellerId: ctx.sellerId,
      maxProducts: body.maxProducts || 20,
      queries: body.queries,
      skipListing: body.skipListing || false,
    }),
  });

  const data = await res.json();
  return jsonResponse(data, res.status);
}

async function handleDiscoveryStatus(ctx: ApiContext): Promise<Response> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [
    discoveredTodayRes,
    euProductsRes,
    listingsTodayRes,
    noSalesRes,
    topProductsRes,
    totalDiscoveredRes,
  ] = await Promise.all([
    // Products discovered today
    ctx.supabase
      .from("source_products")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", ctx.sellerId)
      .eq("source_type", "cjdropshipping")
      .gte("created_at", todayISO),
    // EU warehouse products
    ctx.supabase
      .from("source_products")
      .select("id, title, price_source, price_ebay, attributes_json, images_json")
      .eq("seller_id", ctx.sellerId)
      .eq("source_type", "cjdropshipping")
      .order("created_at", { ascending: false })
      .limit(50),
    // Listings created today
    ctx.supabase
      .from("ebay_offers")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", ctx.sellerId)
      .gte("created_at", todayISO),
    // Products without sales (older than 14 days, no orders)
    ctx.supabase
      .from("ebay_offers")
      .select("id, sku, title, created_at, state")
      .eq("seller_id", ctx.sellerId)
      .in("state", ["published", "active"])
      .lte("created_at", fourteenDaysAgo)
      .limit(20),
    // Top products by price (proxy for performance)
    ctx.supabase
      .from("source_products")
      .select("id, title, price_source, price_ebay, attributes_json")
      .eq("seller_id", ctx.sellerId)
      .eq("source_type", "cjdropshipping")
      .not("price_ebay", "is", null)
      .order("price_ebay", { ascending: false })
      .limit(10),
    // Total discovered
    ctx.supabase
      .from("source_products")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", ctx.sellerId)
      .eq("source_type", "cjdropshipping"),
  ]);

  // Filter EU warehouse products
  const euProducts = (euProductsRes.data || []).filter((p: any) => {
    const attrs = p.attributes_json as any;
    return attrs?.warehouse && ["DE", "PL", "ES", "FR", "CZ", "NL", "IT", "BE"].includes(attrs.warehouse);
  });

  return jsonResponse({
    ok: true,
    discovery: {
      discoveredToday: discoveredTodayRes.count || 0,
      totalDiscovered: totalDiscoveredRes.count || 0,
      euWarehouseProducts: euProducts.length,
      listingsCreatedToday: listingsTodayRes.count || 0,
      dailyTarget: 100,
      topProducts: (topProductsRes.data || []).map((p: any) => ({
        id: p.id,
        title: p.title,
        costPrice: p.price_source,
        sellingPrice: p.price_ebay,
        margin: p.price_ebay && p.price_source
          ? Math.round(((p.price_ebay - p.price_source) / p.price_ebay) * 100)
          : null,
        warehouse: (p.attributes_json as any)?.warehouse,
      })),
      productsWithoutSales: (noSalesRes.data || []).map((p: any) => ({
        id: p.id,
        sku: p.sku,
        title: p.title,
        createdAt: p.created_at,
        daysSinceListing: Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000),
      })),
      timestamp: new Date().toISOString(),
    },
  });
}
