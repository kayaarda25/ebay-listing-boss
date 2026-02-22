const EBAY_API_BASE = "https://api.ebay.com";
const EBAY_AUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";

export async function getEbayAccessToken(): Promise<string> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const refreshToken = Deno.env.get("EBAY_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("eBay API credentials not configured");
  }

  console.log(`Using Client ID: ${clientId.substring(0, 8)}...`);
  console.log(`Refresh Token starts with: ${refreshToken.substring(0, 10)}...`);

  const credentials = btoa(`${clientId}:${clientSecret}`);

  // Use minimal scope - eBay requires the scopes to match what was granted
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(EBAY_AUTH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("eBay OAuth response:", JSON.stringify(data));
    throw new Error(`eBay OAuth failed [${response.status}]: ${JSON.stringify(data)}`);
  }

  console.log("eBay access token obtained successfully");
  return data.access_token;
}

export { EBAY_API_BASE };
