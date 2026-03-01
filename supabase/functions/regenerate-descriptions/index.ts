import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Regenerate titles and descriptions for existing products in German.
 * Body: { sellerId: string, productIds?: string[], limit?: number }
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const sellerId = body.sellerId;
    const productIds: string[] | undefined = body.productIds;
    const limit = body.limit || 50;

    if (!sellerId) {
      return jsonRes({ ok: false, error: "sellerId required" }, 422);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return jsonRes({ ok: false, error: "LOVABLE_API_KEY not configured" }, 500);
    }

    // Fetch products to regenerate
    let query = supabase
      .from("source_products")
      .select("id, source_id, title, description")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (productIds && productIds.length > 0) {
      query = query.in("id", productIds);
    }

    const { data: products, error: fetchErr } = await query;
    if (fetchErr) return jsonRes({ ok: false, error: fetchErr.message }, 500);
    if (!products || products.length === 0) return jsonRes({ ok: true, updated: 0 });

    const updated: string[] = [];
    const errors: string[] = [];

    for (const product of products) {
      try {
        // Generate German title
        const titleRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content: `Du bist ein eBay-Listing-Titel-Optimierer für den deutschen Markt.
Regeln:
- Max 80 Zeichen
- Struktur: Hauptkeyword + Vorteil + Anwendung
- Keine Sonderzeichen außer – und &
- Keine Markennamen, verwende "Kompatibel mit..." oder lasse die Marke weg
- IMMER auf Deutsch, NIEMALS auf Englisch
- Antworte NUR mit dem Titel, nichts anderes`,
              },
              {
                role: "user",
                content: `Erstelle einen optimierten deutschen eBay-Titel für: ${product.title}`,
              },
            ],
          }),
        });

        let newTitle = product.title;
        if (titleRes.ok) {
          const titleData = await titleRes.json();
          const t = titleData.choices?.[0]?.message?.content?.trim();
          if (t && t.length > 0 && t.length <= 80) newTitle = t;
        }

        // Generate German description
        const descRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content: `Du bist ein eBay-Produktbeschreibungs-Texter für den deutschen Markt.

Struktur:
1. 🎯 Produktvorteile (3-4 Aufzählungspunkte)
2. 📦 So funktioniert es (2-3 Sätze)
3. ❤️ Warum Kunden es lieben (3 Aufzählungspunkte)
4. 📋 Lieferumfang (Liste)

Regeln:
- Maximal 500 Wörter
- HTML-Formatierung verwenden (b, ul, li, br)
- Keine Markennamen
- Überzeugend aber ehrlich
- IMMER auf Deutsch, NIEMALS auf Englisch
- Antworte NUR mit der HTML-Beschreibung`,
              },
              {
                role: "user",
                content: `Erstelle eine deutsche Produktbeschreibung für: ${newTitle}\nOriginalprodukt: ${product.title}`,
              },
            ],
          }),
        });

        let newDesc = product.description || "";
        if (descRes.ok) {
          const descData = await descRes.json();
          const d = descData.choices?.[0]?.message?.content?.trim();
          if (d && d.length > 0) newDesc = d;
        }

        // Update product
        const { error: updateErr } = await supabase
          .from("source_products")
          .update({ title: newTitle, description: newDesc })
          .eq("id", product.id);

        if (updateErr) {
          errors.push(`${product.id}: ${updateErr.message}`);
        } else {
          updated.push(product.id);
        }

        // Also update corresponding ebay_offers
        await supabase
          .from("ebay_offers")
          .update({ title: newTitle.substring(0, 80) })
          .eq("seller_id", sellerId)
          .eq("sku", product.source_id);

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        errors.push(`${product.id}: ${String(err)}`);
      }
    }

    return jsonRes({
      ok: true,
      total: products.length,
      updated: updated.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("Regenerate error:", err);
    return jsonRes({ ok: false, error: String(err) }, 500);
  }
});

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  });
}
