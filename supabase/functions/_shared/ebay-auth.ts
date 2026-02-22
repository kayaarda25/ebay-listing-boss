const EBAY_API_BASE = "https://api.ebay.com";
const EBAY_AUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";

export async function getEbayAccessToken(): Promise<string> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const refreshToken = Deno.env.get("EBAY_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("eBay API credentials not configured");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(EBAY_AUTH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.account",
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`eBay OAuth failed [${response.status}]: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

export { EBAY_API_BASE };
