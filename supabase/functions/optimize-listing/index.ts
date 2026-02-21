const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { title, description, brand, category } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'AI not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `Du bist ein eBay-Listing-Experte für den deutschen Markt. Optimiere Produkttitel und Beschreibungen für maximale Sichtbarkeit und Verkäufe auf eBay.de.

Regeln:
- Titel: Max 80 Zeichen, wichtigste Keywords zuerst, Marke + Produkttyp + Eigenschaften
- Beschreibung: Professionell, strukturiert mit Aufzählungszeichen, SEO-optimiert für eBay
- Sprache: Deutsch
- Vermeide Großbuchstaben-Spam und übertriebene Sonderzeichen
- Füge relevante Suchbegriffe ein die Käufer verwenden würden`;

    const userPrompt = `Optimiere dieses Produkt für ein eBay-Listing:

Titel: ${title}
${brand ? `Marke: ${brand}` : ''}
${category ? `Kategorie: ${category}` : ''}
${description ? `Beschreibung: ${description}` : ''}

Antworte im JSON-Format mit den Feldern "title" und "description".`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'optimized_listing',
              description: 'Return the optimized eBay listing title and description',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Optimized eBay listing title (max 80 chars)' },
                  description: { type: 'string', description: 'Optimized eBay listing description in German with bullet points' },
                },
                required: ['title', 'description'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'optimized_listing' } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit erreicht, bitte versuche es später erneut.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'AI-Credits aufgebraucht.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errText = await response.text();
      console.error('AI error:', response.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: 'AI-Fehler' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      const optimized = JSON.parse(toolCall.function.arguments);
      return new Response(
        JSON.stringify({ success: true, ...optimized }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fallback: try to parse from content
    const content = data.choices?.[0]?.message?.content || '';
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return new Response(
          JSON.stringify({ success: true, title: parsed.title, description: parsed.description }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch {}

    return new Response(
      JSON.stringify({ success: false, error: 'Konnte keine optimierten Daten extrahieren' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
