
-- Fix: Drop all RESTRICTIVE policies and recreate as PERMISSIVE

-- user_roles
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- sellers
DROP POLICY IF EXISTS "Sellers can view own record" ON public.sellers;
DROP POLICY IF EXISTS "Users can create own seller" ON public.sellers;
DROP POLICY IF EXISTS "Sellers can update own record" ON public.sellers;
DROP POLICY IF EXISTS "Admins can delete sellers" ON public.sellers;

CREATE POLICY "Sellers can view own record" ON public.sellers FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can create own seller" ON public.sellers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Sellers can update own record" ON public.sellers FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete sellers" ON public.sellers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- source_products
DROP POLICY IF EXISTS "Sellers see own products" ON public.source_products;
DROP POLICY IF EXISTS "Sellers create own products" ON public.source_products;
DROP POLICY IF EXISTS "Sellers update own products" ON public.source_products;
DROP POLICY IF EXISTS "Sellers delete own products" ON public.source_products;

CREATE POLICY "Sellers see own products" ON public.source_products FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own products" ON public.source_products FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own products" ON public.source_products FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own products" ON public.source_products FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- ebay_inventory_items
DROP POLICY IF EXISTS "Sellers see own items" ON public.ebay_inventory_items;
DROP POLICY IF EXISTS "Sellers create own items" ON public.ebay_inventory_items;
DROP POLICY IF EXISTS "Sellers update own items" ON public.ebay_inventory_items;
DROP POLICY IF EXISTS "Sellers delete own items" ON public.ebay_inventory_items;

CREATE POLICY "Sellers see own items" ON public.ebay_inventory_items FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own items" ON public.ebay_inventory_items FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own items" ON public.ebay_inventory_items FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own items" ON public.ebay_inventory_items FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- ebay_offers
DROP POLICY IF EXISTS "Sellers see own offers" ON public.ebay_offers;
DROP POLICY IF EXISTS "Sellers create own offers" ON public.ebay_offers;
DROP POLICY IF EXISTS "Sellers update own offers" ON public.ebay_offers;
DROP POLICY IF EXISTS "Sellers delete own offers" ON public.ebay_offers;

CREATE POLICY "Sellers see own offers" ON public.ebay_offers FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own offers" ON public.ebay_offers FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own offers" ON public.ebay_offers FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own offers" ON public.ebay_offers FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- orders
DROP POLICY IF EXISTS "Sellers see own orders" ON public.orders;
DROP POLICY IF EXISTS "Sellers create own orders" ON public.orders;
DROP POLICY IF EXISTS "Sellers update own orders" ON public.orders;
DROP POLICY IF EXISTS "Sellers delete own orders" ON public.orders;

CREATE POLICY "Sellers see own orders" ON public.orders FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own orders" ON public.orders FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own orders" ON public.orders FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- order_items
DROP POLICY IF EXISTS "Sellers see own order items" ON public.order_items;
DROP POLICY IF EXISTS "Sellers create own order items" ON public.order_items;
DROP POLICY IF EXISTS "Sellers update own order items" ON public.order_items;
DROP POLICY IF EXISTS "Sellers delete own order items" ON public.order_items;

CREATE POLICY "Sellers see own order items" ON public.order_items FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own order items" ON public.order_items FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own order items" ON public.order_items FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own order items" ON public.order_items FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- shipments
DROP POLICY IF EXISTS "Sellers see own shipments" ON public.shipments;
DROP POLICY IF EXISTS "Sellers create own shipments" ON public.shipments;
DROP POLICY IF EXISTS "Sellers update own shipments" ON public.shipments;
DROP POLICY IF EXISTS "Sellers delete own shipments" ON public.shipments;

CREATE POLICY "Sellers see own shipments" ON public.shipments FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own shipments" ON public.shipments FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own shipments" ON public.shipments FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own shipments" ON public.shipments FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- Auto-create seller record on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.sellers (user_id) VALUES (NEW.id);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'seller');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
