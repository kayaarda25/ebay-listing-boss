import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

/**
 * Get a valid CJ access token.
 * Tokens are cached in api_token_cache table to avoid hitting the QPS limit (1 req/300s).
 */
export async function getCJAccessToken(): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check cache first
  const { data: cached } = await supabase
    .from("api_token_cache")
    .select("access_token, expires_at")
    .eq("id", "cj_api")
    .maybeSingle();

  if (cached && new Date(cached.expires_at) > new Date()) {
    return cached.access_token;
  }

  // Fetch new token
  const email = Deno.env.get("CJ_EMAIL");
  const apiKey = Deno.env.get("CJ_API_KEY");
  if (!email || !apiKey) throw new Error("CJ_EMAIL or CJ_API_KEY not configured");

  const res = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: apiKey }),
  });

  const data = await res.json();
  if (!res.ok || data.code !== 200) {
    throw new Error(`CJ auth failed: ${data.message || JSON.stringify(data)}`);
  }

  const accessToken = data.data?.accessToken;
  if (!accessToken) throw new Error("No accessToken in CJ response");

  // Cache for 23 hours (tokens typically last 24h)
  const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();

  await supabase.from("api_token_cache").upsert({
    id: "cj_api",
    access_token: accessToken,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });

  return accessToken;
}

export { CJ_BASE };
