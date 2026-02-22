import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

/**
 * Get a valid CJ access token.
 * Tokens are cached in the sellers table (or env) and refreshed when expired.
 */
export async function getCJAccessToken(): Promise<string> {
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

  return data.data?.accessToken;
}

export { CJ_BASE };
