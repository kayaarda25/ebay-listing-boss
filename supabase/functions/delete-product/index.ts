import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nicht autorisiert' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { productId, sellerId } = await req.json();

    if (!productId || !sellerId) {
      return new Response(
        JSON.stringify({ success: false, error: 'productId und sellerId sind erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Find linked eBay inventory items
    const { data: inventoryItems } = await supabase
      .from('ebay_inventory_items')
      .select('id, sku')
      .eq('source_product_id', productId)
      .eq('seller_id', sellerId);

    const deletedSkus: string[] = [];

    if (inventoryItems && inventoryItems.length > 0) {
      for (const item of inventoryItems) {
        // 2. Delete linked eBay offers
        const { error: offerDeleteError } = await supabase
          .from('ebay_offers')
          .delete()
          .eq('sku', item.sku)
          .eq('seller_id', sellerId);

        if (offerDeleteError) {
          console.warn(`Failed to delete offers for SKU ${item.sku}:`, offerDeleteError);
        }

        // 3. Delete the inventory item
        const { error: invDeleteError } = await supabase
          .from('ebay_inventory_items')
          .delete()
          .eq('id', item.id);

        if (invDeleteError) {
          console.warn(`Failed to delete inventory item ${item.id}:`, invDeleteError);
        } else {
          deletedSkus.push(item.sku);
        }
      }
    }

    // 4. Delete product images from storage
    const { data: product } = await supabase
      .from('source_products')
      .select('images_json')
      .eq('id', productId)
      .eq('seller_id', sellerId)
      .maybeSingle();

    if (product?.images_json && Array.isArray(product.images_json)) {
      const storageFiles = (product.images_json as string[])
        .filter((url: string) => url.includes('product-images'))
        .map((url: string) => {
          const parts = url.split('/product-images/');
          return parts.length > 1 ? parts[1].split('?')[0] : null;
        })
        .filter(Boolean) as string[];

      if (storageFiles.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('product-images')
          .remove(storageFiles);
        if (storageError) {
          console.warn('Failed to delete some storage files:', storageError);
        }
      }
    }

    // 5. Delete the source product
    const { error: productDeleteError } = await supabase
      .from('source_products')
      .delete()
      .eq('id', productId)
      .eq('seller_id', sellerId);

    if (productDeleteError) {
      console.error('Failed to delete product:', productDeleteError);
      return new Response(
        JSON.stringify({ success: false, error: 'Produkt konnte nicht gelöscht werden' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Deleted product ${productId}, eBay SKUs: ${deletedSkus.join(', ') || 'none'}`);

    return new Response(
      JSON.stringify({
        success: true,
        deletedSkus,
        message: deletedSkus.length > 0
          ? `Produkt und ${deletedSkus.length} eBay-Listing(s) gelöscht`
          : 'Produkt gelöscht (kein eBay-Listing vorhanden)',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
