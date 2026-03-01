import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EBAY_TRADING_API = "https://api.ebay.com/ws/api.dll";
const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";

interface EbayTradingCallOptions {
  callName: string;
  body: string;
  siteId?: string;
  sellerId?: string;
}

/**
 * Resolve the eBay User Token for a given seller.
 * 1. If sellerId provided → look up seller.refresh_token_enc → exchange for user token (cached)
 * 2. Fallback → use global EBAY_AUTH_TOKEN env var
 */
async function resolveAuthToken(sellerId?: string): Promise<string> {
  if (!sellerId) {
    const globalToken = Deno.env.get("EBAY_AUTH_TOKEN");
    if (!globalToken) throw new Error("EBAY_AUTH_TOKEN not configured");
    return globalToken;
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: seller } = await supabase
    .from("sellers")
    .select("refresh_token_enc, ebay_user_id")
    .eq("id", sellerId)
    .single();

  if (!seller?.refresh_token_enc) {
    // No per-seller token → fall back to global
    const globalToken = Deno.env.get("EBAY_AUTH_TOKEN");
    if (!globalToken) throw new Error("No auth token for seller and no global EBAY_AUTH_TOKEN");
    return globalToken;
  }

  // Resolve the actual refresh token from secret reference or direct value
  const refreshToken = resolveRefreshToken(seller.refresh_token_enc);
  if (!refreshToken) {
    throw new Error(`Refresh token not found for seller ${seller.ebay_user_id || sellerId}`);
  }

  // Auth'n'Auth tokens start with "v^1.1#" and are used directly (not exchanged)
  if (refreshToken.startsWith("v^1.1#")) {
    console.log(`Using Auth'n'Auth token directly for seller ${seller.ebay_user_id || sellerId}`);
    return refreshToken;
  }

  // OAuth refresh token → exchange for access token
  // Check cache
  const cacheKey = `ebay_user_token_${sellerId}`;
  const { data: cached } = await supabase
    .from("api_token_cache")
    .select("access_token, expires_at")
    .eq("id", cacheKey)
    .maybeSingle();

  if (cached && new Date(cached.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return cached.access_token;
  }

  // Exchange refresh token for user token
  const clientId = Deno.env.get("EBAY_CLIENT_ID")!;
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET")!;
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const scopes = [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    "https://api.ebay.com/oauth/api_scope/sell.account",
    "https://api.ebay.com/oauth/api_scope/sell.marketing",
  ].join(" ");

  const res = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basicAuth}`,
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&scope=${encodeURIComponent(scopes)}`,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`eBay token exchange failed [${res.status}]: ${errText.substring(0, 500)}`);
  }

  const tokenData = await res.json();
  const accessToken = tokenData.access_token;
  const expiresIn = tokenData.expires_in || 7200;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Cache the token
  await supabase.from("api_token_cache").upsert({
    id: cacheKey,
    access_token: accessToken,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });

  console.log(`eBay token refreshed for seller ${seller.ebay_user_id || sellerId}, expires: ${expiresAt}`);
  return accessToken;
}

/**
 * Resolve refresh token from "secret:SECRET_NAME" reference or return as-is.
 */
function resolveRefreshToken(tokenRef: string): string | null {
  if (tokenRef.startsWith("secret:")) {
    const secretName = tokenRef.replace("secret:", "");
    return Deno.env.get(secretName) || null;
  }
  return tokenRef;
}

export async function ebayTradingCall({ callName, body, siteId = "77", sellerId }: EbayTradingCallOptions): Promise<string> {
  const devId = Deno.env.get("EBAY_DEV_ID");
  const appId = Deno.env.get("EBAY_CLIENT_ID");
  const certId = Deno.env.get("EBAY_CLIENT_SECRET");
  const authToken = await resolveAuthToken(sellerId);

  if (!devId || !appId || !certId) {
    throw new Error("eBay credentials not configured. Need: EBAY_DEV_ID, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET");
  }

  const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  ${body}
</${callName}Request>`;

  const response = await fetch(EBAY_TRADING_API, {
    method: "POST",
    headers: {
      "X-EBAY-API-SITEID": siteId,
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1349",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-DEV-NAME": devId,
      "X-EBAY-API-APP-NAME": appId,
      "X-EBAY-API-CERT-NAME": certId,
      "Content-Type": "text/xml",
    },
    body: xmlRequest,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`eBay Trading API [${response.status}]: ${text.substring(0, 500)}`);
  }

  // Check for eBay error in response
  if (text.includes("<Ack>Failure</Ack>")) {
    const allLongMessages = xmlValues(text, "LongMessage");
    const allShortMessages = xmlValues(text, "ShortMessage");
    const allErrorCodes = xmlValues(text, "ErrorCode");
    
    console.error(`eBay Failure – all errors: ${JSON.stringify({ codes: allErrorCodes, long: allLongMessages, short: allShortMessages })}`);
    console.error(`eBay full response (first 2000 chars): ${text.substring(0, 2000)}`);

    const errorMsg = allLongMessages[0] || allShortMessages[0] || "Unknown error";

    const hasItemId = /<ItemID>[^<]+<\/ItemID>/.test(text);
    if (hasItemId) {
      console.warn(`eBay reported Failure but ItemID found – treating as warning: ${errorMsg}`);
    } else {
      const realErrors = allLongMessages.filter(m => !isPaymentHoldMessage(m));
      if (realErrors.length > 0) {
        throw new Error(`eBay Error: ${realErrors.join(' | ')}`);
      }
      throw new Error(`eBay Error: ${errorMsg}`);
    }
  }

  if (text.includes("<Ack>Warning</Ack>")) {
    const warnMatch = text.match(/<LongMessage>(.*?)<\/LongMessage>/);
    console.warn(`eBay Warning: ${warnMatch?.[1] || "Unknown warning"}`);
  }

  return text;
}

// Simple XML value extractor
export function xmlValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "s"));
  return match ? match[1].trim() : null;
}

export function xmlAttr(xml: string, tag: string, attr: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\s[^>]*${attr}="([^"]*)"`, "s"));
  return match ? match[1] : null;
}

export function xmlValues(xml: string, tag: string): string[] {
  const matches = [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "gs"))];
  return matches.map(m => m[1].trim());
}

export function xmlBlocks(xml: string, tag: string): string[] {
  const matches = [...xml.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "gs"))];
  return matches.map(m => m[1]);
}

function isPaymentHoldMessage(message: string): boolean {
  const n = message.toLowerCase();
  return n.includes("einbehalten") || n.includes("pending-payments") || n.includes("nicht verfügbar");
}
