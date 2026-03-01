import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 req/min

export interface ApiContext {
  supabase: ReturnType<typeof createClient>;
  sellerId: string;
  apiKeyId: string;
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(error: string, status = 500, code?: string) {
  return new Response(JSON.stringify({ ok: false, error, code }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Authenticate API request via Bearer token.
 * Token is SHA-256 hashed and compared against api_keys table.
 */
export async function authenticateRequest(req: Request): Promise<ApiContext | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Support both X-API-Key header and Authorization: Bearer
  const xApiKey = req.headers.get("X-API-Key");
  const authHeader = req.headers.get("Authorization");
  
  let token: string | null = null;
  if (xApiKey) {
    token = xApiKey;
  } else if (authHeader?.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7);
    // Skip JWT tokens (they contain dots) - only accept API keys
    if (!bearerToken.includes(".")) {
      token = bearerToken;
    }
  }

  if (!token) {
    return errorResponse("Missing API key. Use X-API-Key header or Authorization: Bearer <api-key>", 401, "UNAUTHORIZED");
  }
  
  // Hash the token
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  console.log("Looking up key hash:", keyHash, "token length:", token.length);

  // Look up key
  const { data: apiKey, error } = await supabase
    .from("api_keys")
    .select("id, seller_id, is_active, name")
    .eq("key_hash", keyHash)
    .maybeSingle();

  console.log("Key lookup result:", apiKey ? `found: ${apiKey.name}` : "not found", "error:", error?.message);

  if (error || !apiKey) {
    return errorResponse("Invalid API key", 401, "UNAUTHORIZED");
  }

  if (!apiKey.is_active) {
    return errorResponse("API key is deactivated", 403, "FORBIDDEN");
  }

  // Rate limiting
  const windowStart = new Date(Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS).toISOString();

  const { data: rateData } = await supabase
    .from("api_rate_limits")
    .select("request_count")
    .eq("api_key_id", apiKey.id)
    .eq("window_start", windowStart)
    .maybeSingle();

  if (rateData && rateData.request_count >= RATE_LIMIT_MAX) {
    return errorResponse("Rate limit exceeded (60 req/min)", 429, "RATE_LIMITED");
  }

  // Upsert rate limit counter
  await supabase.from("api_rate_limits").upsert({
    api_key_id: apiKey.id,
    window_start: windowStart,
    request_count: (rateData?.request_count || 0) + 1,
  }, { onConflict: "api_key_id,window_start" });

  // Update last_used_at
  await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id);

  return { supabase, sellerId: apiKey.seller_id, apiKeyId: apiKey.id };
}

/**
 * Log API request to audit log
 */
export async function auditLog(
  ctx: ApiContext,
  req: Request,
  statusCode: number,
  startTime: number,
) {
  const duration = Date.now() - startTime;
  const url = new URL(req.url);
  await ctx.supabase.from("api_audit_log").insert({
    api_key_id: ctx.apiKeyId,
    seller_id: ctx.sellerId,
    method: req.method,
    path: url.pathname + url.search,
    status_code: statusCode,
    duration_ms: duration,
    ip: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown",
  });
}
