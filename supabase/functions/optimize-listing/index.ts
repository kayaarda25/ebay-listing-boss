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
        JSON.stringify({ success: false, error: 'LOVABLE_API_KEY nicht konfiguriert' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `Du bist ein eBay-Listing-Experte für den deutschen Markt. Optimiere Produkttitel und Beschreibungen für maximale Sichtbarkeit und Verkäufe auf eBay.de.

Regeln:
- WICHTIG: Erwähne NIEMALS Markennamen im Titel oder in der Beschreibung. Ersetze Marken durch generische Begriffe (z.B. "Kompatibel mit..." statt Markenname, oder lasse die Marke komplett weg)
- Titel: Max 80 Zeichen, wichtigste Keywords zuerst, Produkttyp + Eigenschaften
- Beschreibung: Professionell, strukturiert mit HTML (b, ul, li, br), SEO-optimiert für eBay
- IMMER auf Deutsch, NIEMALS auf Englisch
- Vermeide Großbuchstaben-Spam und übertriebene Sonderzeichen
- Füge relevante Suchbegriffe ein die Käufer verwenden würden
- Setze "Markenlos" oder "No-Name" wenn nach Marke gefragt wird

Antworte NUR mit einem JSON-Objekt mit den Feldern "title" und "description". Kein anderer Text.`;

    const userPrompt = `Optimiere dieses Produkt für ein eBay-Listing:

Titel: ${title}
${brand ? `Marke: ${brand}` : ''}
${category ? `Kategorie: ${category}` : ''}
${description ? `Beschreibung: ${description}` : ''}`;

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
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI API error:', response.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: `AI-Fehler (${response.status})` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    try {
      const parsed = JSON.parse(content);
      return new Response(
        JSON.stringify({ success: true, title: parsed.title, description: parsed.description }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch {
      console.error('Failed to parse AI response:', content);
      return new Response(
        JSON.stringify({ success: false, error: 'Konnte AI-Antwort nicht parsen' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
