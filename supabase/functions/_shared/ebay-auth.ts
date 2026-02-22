const EBAY_TRADING_API = "https://api.ebay.com/ws/api.dll";

interface EbayTradingCallOptions {
  callName: string;
  body: string;
  siteId?: string;
}

export async function ebayTradingCall({ callName, body, siteId = "77" }: EbayTradingCallOptions): Promise<string> {
  const devId = Deno.env.get("EBAY_DEV_ID");
  const appId = Deno.env.get("EBAY_CLIENT_ID");
  const certId = Deno.env.get("EBAY_CLIENT_SECRET");
  const authToken = Deno.env.get("EBAY_AUTH_TOKEN");

  if (!devId || !appId || !certId || !authToken) {
    throw new Error("eBay Auth'n'Auth credentials not configured. Need: EBAY_DEV_ID, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_AUTH_TOKEN");
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

  // Check for eBay error in response — only fail on Failure, not Warning
  if (text.includes("<Ack>Failure</Ack>")) {
    const errorMatch = text.match(/<ShortMessage>(.*?)<\/ShortMessage>/);
    const longMatch = text.match(/<LongMessage>(.*?)<\/LongMessage>/);
    throw new Error(`eBay Error: ${errorMatch?.[1] || longMatch?.[1] || "Unknown error"}`);
  }

  // Log warnings but don't throw
  if (text.includes("<Ack>Warning</Ack>")) {
    const warnMatch = text.match(/<LongMessage>(.*?)<\/LongMessage>/);
    console.warn(`eBay Warning: ${warnMatch?.[1] || "Unknown warning"}`);
  }

  return text;
}

// Simple XML value extractor (handles tags with attributes like <Total currencyID="EUR">29.99</Total>)
export function xmlValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "s"));
  return match ? match[1].trim() : null;
}

// Extract attribute from a tag
export function xmlAttr(xml: string, tag: string, attr: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\s[^>]*${attr}="([^"]*)"`, "s"));
  return match ? match[1] : null;
}

// Extract all matches of a tag
export function xmlValues(xml: string, tag: string): string[] {
  const matches = [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "gs"))];
  return matches.map(m => m[1].trim());
}

// Extract blocks between tags
export function xmlBlocks(xml: string, tag: string): string[] {
  const matches = [...xml.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "gs"))];
  return matches.map(m => m[1]);
}
