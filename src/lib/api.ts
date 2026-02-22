import { supabase } from "@/integrations/supabase/client";

export async function fetchDashboardStats(sellerId: string) {
  const [offersRes, ordersRes, shipmentsRes] = await Promise.all([
    supabase.from("ebay_offers").select("id, state, price, quantity").eq("seller_id", sellerId),
    supabase.from("orders").select("id, order_status, total_price, created_at").eq("seller_id", sellerId),
    supabase.from("shipments").select("id").eq("seller_id", sellerId),
  ]);

  const offers = offersRes.data || [];
  const orders = ordersRes.data || [];

  const activeListings = offers.filter((o) => o.state === "published" || o.state === "active").length;
  const pausedListings = offers.filter((o) => o.state === "paused").length;
  const openOrders = orders.filter((o) => o.order_status === "pending").length;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const revenue30Days = orders
    .filter((o) => new Date(o.created_at) >= thirtyDaysAgo && o.order_status !== "cancelled")
    .reduce((sum, o) => sum + (o.total_price || 0), 0);

  return {
    activeListings,
    pausedListings,
    openOrders,
    revenue30Days,
    totalOffers: offers.length,
    totalOrders: orders.length,
  };
}

export async function fetchListings(sellerId: string) {
  const [offersRes, productsRes] = await Promise.all([
    supabase
      .from("ebay_offers")
      .select("*")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false }),
    supabase
      .from("source_products")
      .select("source_id, price_source")
      .eq("seller_id", sellerId),
  ]);
  const offers = offersRes.data || [];
  const priceMap = new Map(
    (productsRes.data || []).map((p) => [p.source_id, p.price_source])
  );
  return offers.map((o) => ({
    ...o,
    purchase_price: priceMap.get(o.sku) ?? null,
  }));
}

export async function fetchOrders(sellerId: string) {
  const { data } = await supabase
    .from("orders")
    .select("*, shipments(*)")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });
  return data || [];
}

export async function fetchSeller(sellerId: string) {
  const { data } = await supabase
    .from("sellers")
    .select("*")
    .eq("id", sellerId)
    .maybeSingle();
  return data;
}
