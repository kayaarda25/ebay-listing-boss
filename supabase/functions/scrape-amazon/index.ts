const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { asins } = await req.json();

    if (!asins || !Array.isArray(asins) || asins.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'asins array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: Record<string, any> = {};

    for (const asin of asins.slice(0, 25)) {
      const url = `https://www.amazon.de/dp/${asin}`;
      console.log(`Scraping ${url}`);

      try {
        const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            formats: ['extract'],
            extract: {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Full product title' },
                  price: { type: 'number', description: 'Current price in EUR as a number' },
                  description: { type: 'string', description: 'Product description or bullet points combined into one text' },
                  bullet_points: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Individual product feature bullet points as separate strings',
                  },
                  images: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of product image URLs (high resolution)',
                  },
                  availability: { type: 'string', description: 'Stock availability text (e.g. "Auf Lager")' },
                  brand: { type: 'string', description: 'Brand name / Marke' },
                  manufacturer: { type: 'string', description: 'Manufacturer / Hersteller' },
                  mpn: { type: 'string', description: 'Manufacturer Part Number / Herstellernummer / Modellnummer' },
                  ean: { type: 'string', description: 'EAN / GTIN / barcode number (13-digit)' },
                  asin_value: { type: 'string', description: 'ASIN from technical details' },
                  color: { type: 'string', description: 'Color / Farbe of the product' },
                  size: { type: 'string', description: 'Size / Größe of the product' },
                  material: { type: 'string', description: 'Material of the product' },
                  weight: { type: 'string', description: 'Product weight including unit (e.g. "500 g", "1.2 kg")' },
                  dimensions: { type: 'string', description: 'Product dimensions (e.g. "30 x 20 x 10 cm")' },
                  category: { type: 'string', description: 'Product category from breadcrumb or classification' },
                  rating: { type: 'number', description: 'Average rating out of 5' },
                  review_count: { type: 'number', description: 'Number of reviews' },
                  energy_class: { type: 'string', description: 'Energy efficiency class if applicable (e.g. "A++")' },
                  technical_details: {
                    type: 'object',
                    description: 'All key-value pairs from the technical details / product information table',
                    additionalProperties: { type: 'string' },
                  },
                },
                required: ['title'],
              },
            },
            waitFor: 2000,
            location: { country: 'DE', languages: ['de'] },
          }),
        });

        const data = await response.json();

        if (response.ok && data.success !== false) {
          const extracted = data.data?.extract || data.extract || data.data?.json || data.json || {};
          results[asin] = {
            success: true,
            title: extracted.title || `Amazon ${asin}`,
            price: extracted.price || null,
            description: extracted.description || null,
            bullet_points: extracted.bullet_points || [],
            images: extracted.images || [],
            availability: extracted.availability || null,
            brand: extracted.brand || null,
            manufacturer: extracted.manufacturer || null,
            mpn: extracted.mpn || null,
            ean: extracted.ean || null,
            color: extracted.color || null,
            size: extracted.size || null,
            material: extracted.material || null,
            weight: extracted.weight || null,
            dimensions: extracted.dimensions || null,
            category: extracted.category || null,
            rating: extracted.rating || null,
            review_count: extracted.review_count || null,
            energy_class: extracted.energy_class || null,
            technical_details: extracted.technical_details || {},
          };
          console.log(`Scraped ${asin}: ${extracted.title} | EAN: ${extracted.ean} | Brand: ${extracted.brand}`);
        } else {
          console.error(`Firecrawl error for ${asin}:`, data);
          results[asin] = { success: false, error: data.error || 'Scrape failed' };
        }
      } catch (err) {
        console.error(`Error scraping ${asin}:`, err);
        results[asin] = { success: false, error: String(err) };
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
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
