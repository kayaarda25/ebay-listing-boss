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

    for (const asin of asins.slice(0, 10)) {
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
                  title: { type: 'string', description: 'Product title' },
                  price: { type: 'number', description: 'Current price in EUR as a number' },
                  description: { type: 'string', description: 'Product description or bullet points combined' },
                  images: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of product image URLs (high resolution)',
                  },
                  availability: { type: 'string', description: 'Stock availability text' },
                  brand: { type: 'string', description: 'Brand name' },
                  rating: { type: 'number', description: 'Average rating out of 5' },
                  review_count: { type: 'number', description: 'Number of reviews' },
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
            images: extracted.images || [],
            availability: extracted.availability || null,
            brand: extracted.brand || null,
            rating: extracted.rating || null,
            review_count: extracted.review_count || null,
          };
          console.log(`Scraped ${asin}: ${extracted.title}`);
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
