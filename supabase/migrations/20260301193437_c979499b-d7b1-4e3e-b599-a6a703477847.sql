
-- Fix get_seller_id to be usable but also update all RLS policies to support multi-store
-- by checking seller ownership directly instead of using get_seller_id()

-- Drop and recreate all RLS policies that use get_seller_id() to use a direct check instead

-- ebay_offers
DROP POLICY IF EXISTS "Sellers see own offers" ON public.ebay_offers;
CREATE POLICY "Sellers see own offers" ON public.ebay_offers FOR SELECT
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers create own offers" ON public.ebay_offers;
CREATE POLICY "Sellers create own offers" ON public.ebay_offers FOR INSERT
  WITH CHECK (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers update own offers" ON public.ebay_offers;
CREATE POLICY "Sellers update own offers" ON public.ebay_offers FOR UPDATE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers delete own offers" ON public.ebay_offers;
CREATE POLICY "Sellers delete own offers" ON public.ebay_offers FOR DELETE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- source_products
DROP POLICY IF EXISTS "Sellers see own products" ON public.source_products;
CREATE POLICY "Sellers see own products" ON public.source_products FOR SELECT
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers create own products" ON public.source_products;
CREATE POLICY "Sellers create own products" ON public.source_products FOR INSERT
  WITH CHECK (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers update own products" ON public.source_products;
CREATE POLICY "Sellers update own products" ON public.source_products FOR UPDATE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers delete own products" ON public.source_products;
CREATE POLICY "Sellers delete own products" ON public.source_products FOR DELETE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- orders
DROP POLICY IF EXISTS "Sellers see own orders" ON public.orders;
CREATE POLICY "Sellers see own orders" ON public.orders FOR SELECT
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers create own orders" ON public.orders;
CREATE POLICY "Sellers create own orders" ON public.orders FOR INSERT
  WITH CHECK (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers update own orders" ON public.orders;
CREATE POLICY "Sellers update own orders" ON public.orders FOR UPDATE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers delete own orders" ON public.orders;
CREATE POLICY "Sellers delete own orders" ON public.orders FOR DELETE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- order_items
DROP POLICY IF EXISTS "Sellers see own order items" ON public.order_items;
CREATE POLICY "Sellers see own order items" ON public.order_items FOR SELECT
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers create own order items" ON public.order_items;
CREATE POLICY "Sellers create own order items" ON public.order_items FOR INSERT
  WITH CHECK (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers update own order items" ON public.order_items;
CREATE POLICY "Sellers update own order items" ON public.order_items FOR UPDATE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers delete own order items" ON public.order_items;
CREATE POLICY "Sellers delete own order items" ON public.order_items FOR DELETE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- shipments
DROP POLICY IF EXISTS "Sellers see own shipments" ON public.shipments;
CREATE POLICY "Sellers see own shipments" ON public.shipments FOR SELECT
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers create own shipments" ON public.shipments;
CREATE POLICY "Sellers create own shipments" ON public.shipments FOR INSERT
  WITH CHECK (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers update own shipments" ON public.shipments;
CREATE POLICY "Sellers update own shipments" ON public.shipments FOR UPDATE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers delete own shipments" ON public.shipments;
CREATE POLICY "Sellers delete own shipments" ON public.shipments FOR DELETE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- ebay_inventory_items
DROP POLICY IF EXISTS "Sellers see own items" ON public.ebay_inventory_items;
CREATE POLICY "Sellers see own items" ON public.ebay_inventory_items FOR SELECT
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers create own items" ON public.ebay_inventory_items;
CREATE POLICY "Sellers create own items" ON public.ebay_inventory_items FOR INSERT
  WITH CHECK (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers update own items" ON public.ebay_inventory_items;
CREATE POLICY "Sellers update own items" ON public.ebay_inventory_items FOR UPDATE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sellers delete own items" ON public.ebay_inventory_items;
CREATE POLICY "Sellers delete own items" ON public.ebay_inventory_items FOR DELETE
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- autopilot_reports
DROP POLICY IF EXISTS "Sellers see own reports" ON public.autopilot_reports;
CREATE POLICY "Sellers see own reports" ON public.autopilot_reports FOR SELECT
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
