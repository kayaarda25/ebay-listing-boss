
-- 1. Role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'seller');

-- 2. User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. has_role function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 4. Sellers table (needed before get_seller_id)
CREATE TABLE public.sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ebay_user_id TEXT,
  marketplace TEXT NOT NULL DEFAULT 'EBAY_DE',
  refresh_token_enc TEXT,
  token_scopes TEXT[] DEFAULT ARRAY['sell.inventory', 'sell.fulfillment', 'sell.account'],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;

-- 5. get_seller_id function
CREATE OR REPLACE FUNCTION public.get_seller_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.sellers WHERE user_id = auth.uid() LIMIT 1
$$;

-- 6. Source products
CREATE TABLE public.source_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID REFERENCES public.sellers(id) ON DELETE CASCADE NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'amazon',
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  images_json JSONB DEFAULT '[]'::jsonb,
  attributes_json JSONB DEFAULT '{}'::jsonb,
  price_source NUMERIC(10,2),
  stock_source INTEGER DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.source_products ENABLE ROW LEVEL SECURITY;

-- 7. eBay inventory items
CREATE TABLE public.ebay_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID REFERENCES public.sellers(id) ON DELETE CASCADE NOT NULL,
  sku TEXT NOT NULL,
  source_product_id UUID REFERENCES public.source_products(id) ON DELETE SET NULL,
  payload_hash TEXT,
  last_pushed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(seller_id, sku)
);
ALTER TABLE public.ebay_inventory_items ENABLE ROW LEVEL SECURITY;

-- 8. eBay offers
CREATE TABLE public.ebay_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID REFERENCES public.sellers(id) ON DELETE CASCADE NOT NULL,
  sku TEXT NOT NULL,
  offer_id TEXT,
  listing_id TEXT,
  price NUMERIC(10,2),
  quantity INTEGER DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'draft',
  category_id TEXT,
  fulfillment_policy_id TEXT,
  return_policy_id TEXT,
  payment_policy_id TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ebay_offers ENABLE ROW LEVEL SECURITY;

-- 9. Orders
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID REFERENCES public.sellers(id) ON DELETE CASCADE NOT NULL,
  order_id TEXT NOT NULL,
  buyer_json JSONB DEFAULT '{}'::jsonb,
  total_price NUMERIC(10,2),
  currency TEXT NOT NULL DEFAULT 'EUR',
  order_status TEXT NOT NULL DEFAULT 'pending',
  needs_fulfillment BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(seller_id, order_id)
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- 10. Order items
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  seller_id UUID REFERENCES public.sellers(id) ON DELETE CASCADE NOT NULL,
  line_item_id TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- 11. Shipments
CREATE TABLE public.shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  seller_id UUID REFERENCES public.sellers(id) ON DELETE CASCADE NOT NULL,
  tracking_number TEXT NOT NULL,
  carrier TEXT NOT NULL,
  shipped_at TIMESTAMPTZ DEFAULT now(),
  tracking_pushed BOOLEAN NOT NULL DEFAULT false,
  payload_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

-- 12. Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_sellers_updated_at BEFORE UPDATE ON public.sellers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_source_products_updated_at BEFORE UPDATE ON public.source_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ebay_inventory_items_updated_at BEFORE UPDATE ON public.ebay_inventory_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ebay_offers_updated_at BEFORE UPDATE ON public.ebay_offers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 13. RLS Policies

-- user_roles
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- sellers
CREATE POLICY "Sellers can view own record" ON public.sellers FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can create own seller" ON public.sellers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Sellers can update own record" ON public.sellers FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete sellers" ON public.sellers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- source_products
CREATE POLICY "Sellers see own products" ON public.source_products FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own products" ON public.source_products FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own products" ON public.source_products FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own products" ON public.source_products FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- ebay_inventory_items
CREATE POLICY "Sellers see own items" ON public.ebay_inventory_items FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own items" ON public.ebay_inventory_items FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own items" ON public.ebay_inventory_items FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own items" ON public.ebay_inventory_items FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- ebay_offers
CREATE POLICY "Sellers see own offers" ON public.ebay_offers FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own offers" ON public.ebay_offers FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own offers" ON public.ebay_offers FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own offers" ON public.ebay_offers FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- orders
CREATE POLICY "Sellers see own orders" ON public.orders FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own orders" ON public.orders FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own orders" ON public.orders FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- order_items
CREATE POLICY "Sellers see own order items" ON public.order_items FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own order items" ON public.order_items FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own order items" ON public.order_items FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own order items" ON public.order_items FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- shipments
CREATE POLICY "Sellers see own shipments" ON public.shipments FOR SELECT TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers create own shipments" ON public.shipments FOR INSERT TO authenticated WITH CHECK (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers update own shipments" ON public.shipments FOR UPDATE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Sellers delete own shipments" ON public.shipments FOR DELETE TO authenticated USING (seller_id = public.get_seller_id() OR public.has_role(auth.uid(), 'admin'::app_role));

-- 14. Indexes
CREATE INDEX idx_source_products_seller ON public.source_products(seller_id);
CREATE INDEX idx_ebay_inventory_items_seller ON public.ebay_inventory_items(seller_id);
CREATE INDEX idx_ebay_offers_seller ON public.ebay_offers(seller_id);
CREATE INDEX idx_orders_seller ON public.orders(seller_id);
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_shipments_order ON public.shipments(order_id);
