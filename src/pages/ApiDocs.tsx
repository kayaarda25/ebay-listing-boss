import { DashboardLayout } from "@/components/DashboardLayout";
import { useState } from "react";
import { Book, ChevronDown, ChevronRight, Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

const BASE_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/api`;

interface Endpoint {
  method: "GET" | "POST" | "PATCH";
  path: string;
  description: string;
  params?: string;
  body?: string;
  response: string;
  notes?: string;
}

const endpoints: { section: string; description: string; items: Endpoint[] }[] = [
  {
    section: "Health",
    description: "Prüfe ob die API erreichbar ist. Kein API Key nötig.",
    items: [
      {
        method: "GET",
        path: "/v1/health",
        description: "Health Check – öffentlich, kein Auth nötig",
        response: `{ "ok": true, "version": "1.0.0", "timestamp": "..." }`,
      },
    ],
  },
  {
    section: "Orders",
    description: "eBay Bestellungen abrufen und synchronisieren.",
    items: [
      {
        method: "GET",
        path: "/v1/orders",
        description: "Alle Bestellungen auflisten",
        params: `status = "awaiting_fulfillment" | "fulfilled" | "all" (default: "all")
sync = "true"  → synchronisiert live von eBay vor Antwort`,
        response: `{ "ok": true, "orders": [...], "count": 2 }`,
        notes: "Jede Order enthält order_items[] und shipments[].",
      },
      {
        method: "POST",
        path: "/v1/orders/sync",
        description: "Triggert einen Sync-Job: holt neue eBay Orders und speichert sie in der DB",
        response: `{ "ok": true, "jobId": "uuid", "message": "Order sync job queued" }`,
        notes: "Gibt eine Job-ID zurück. Status über GET /v1/jobs/:jobId abfragen.",
      },
    ],
  },
  {
    section: "Fulfillment (CJ Dropshipping)",
    description: "Bestellungen über CJdropshipping fulfillen und Tracking synchronisieren.",
    items: [
      {
        method: "POST",
        path: "/v1/orders/:orderId/fulfill",
        description: "Erstellt eine CJ Order für diese Bestellung",
        response: `{ "ok": true, "jobId": "uuid", "state": "queued" }`,
        notes: `Idempotent: Wenn bereits eine CJ Order existiert, wird keine neue erstellt.
Benötigt SKU Mapping (POST /v1/sku-map) damit die eBay SKU der CJ Variante zugeordnet werden kann.`,
      },
      {
        method: "POST",
        path: "/v1/orders/:orderId/sync-tracking",
        description: "Holt Tracking von CJ und pusht es an eBay",
        response: `{ "ok": true, "updated": true, "trackingNumber": "...", "carrier": "CJPacket" }`,
        notes: `Idempotent: Wenn Tracking bereits an eBay gepusht wurde, wird es nicht erneut gesendet.
Setzt order_status automatisch auf "shipped".`,
      },
    ],
  },
  {
    section: "Jobs",
    description: "Asynchrone Jobs überwachen (Sync, Fulfillment, etc.).",
    items: [
      {
        method: "GET",
        path: "/v1/jobs/:jobId",
        description: "Job-Status abfragen",
        response: `{ "ok": true, "job": { "id": "...", "type": "orders_sync", "state": "done", "output": {...}, "error": null } }`,
        notes: `States: "queued" → "running" → "done" | "failed"
Bei Failure: 3 Retries mit exponential Backoff (30s, 120s, 480s).`,
      },
    ],
  },
  {
    section: "SKU Mapping",
    description: "Verknüpfung von eBay SKUs mit CJ Varianten-IDs für automatisches Fulfillment.",
    items: [
      {
        method: "GET",
        path: "/v1/sku-map",
        description: "Alle SKU Mappings auflisten",
        response: `{ "ok": true, "skuMap": [{ "id": "...", "ebay_sku": "ABC-123", "cj_variant_id": "...", "active": true }] }`,
      },
      {
        method: "POST",
        path: "/v1/sku-map",
        description: "Neues SKU Mapping erstellen",
        body: `{
  "ebaySku": "ABC-123",
  "cjVariantId": "cj-variant-uuid",
  "defaultQty": 1,        // optional, default: 1
  "minMarginPct": 20,     // optional, default: 20
  "active": true           // optional, default: true
}`,
        response: `{ "ok": true, "skuMap": { ... } }`,
        notes: "Upsert: Wenn ebaySku bereits existiert, wird es aktualisiert.",
      },
      {
        method: "PATCH",
        path: "/v1/sku-map/:id",
        description: "SKU Mapping aktualisieren",
        body: `{ "cjVariantId": "...", "active": false }`,
        response: `{ "ok": true, "skuMap": { ... } }`,
      },
    ],
  },
  {
    section: "Produkte (CJ Suche)",
    description: "CJ Dropshipping Produktkatalog durchsuchen, Details abrufen und Versandkosten berechnen.",
    items: [
      {
        method: "GET",
        path: "/v1/products/search",
        description: "CJ Produkte suchen",
        params: `q = "Suchbegriff" (erforderlich)
page = 1             // optional, Seitennummer
limit = 20           // optional, Ergebnisse pro Seite
country = "DE"       // optional, Lagerfilter
category = "123"     // optional, CJ Kategorie-ID`,
        response: `{ "ok": true, "products": [{ "pid": "...", "name": "...", "image": "...", "price": 4.99 }], "total": 150 }`,
      },
      {
        method: "GET",
        path: "/v1/products/:productId",
        description: "Produktdetails mit Varianten abrufen",
        response: `{ "ok": true, "product": { "pid": "...", "name": "...", "variants": [{ "vid": "...", "price": 3.99, "stock": 500 }] } }`,
        notes: "Gibt alle Varianten mit vid (Varianten-ID) zurück. Die vid wird für Fulfillment und Listings benötigt.",
      },
      {
        method: "POST",
        path: "/v1/products/freight",
        description: "Versandkosten für eine Variante berechnen",
        body: `{
  "vid": "variant-uuid",
  "countryCode": "DE",   // optional, default: "DE"
  "quantity": 1           // optional, default: 1
}`,
        response: `{ "ok": true, "freight": [{ "logisticName": "CJPacket", "estimatedDays": "10-15", "cost": 2.50 }] }`,
      },
    ],
  },
  {
    section: "Listings",
    description: "Produkte von CJ importieren und auf eBay listen.",
    items: [
      {
        method: "POST",
        path: "/v1/listings/prepare",
        description: "CJ Produkt als Draft vorbereiten",
        body: `{ "source": "cj", "cjVariantId": "variant-uuid" }`,
        response: `{ "ok": true, "draft": { "sourceProductId": "...", "title": "...", "sourcePrice": 4.99, "images": [...] } }`,
        notes: "Holt Produktdetails von CJ und speichert sie als source_product.",
      },
      {
        method: "POST",
        path: "/v1/listings/publish",
        description: "eBay Listing veröffentlichen",
        body: `{
  "sourceProductId": "uuid",
  "price": 19.99,
  "quantity": 5,           // optional, default: 1
  "title": "Custom Title", // optional, überschreibt CJ Titel
  "categoryId": "175673"   // optional, eBay Kategorie ID
}`,
        response: `{ "ok": true, "offerId": "...", "jobId": "...", "message": "Listing created, publishing job queued" }`,
        notes: "Idempotent: Wenn ein Listing mit dieser SKU existiert, wird kein neues erstellt.",
      },
    ],
  },
  {
    section: "API Keys",
    description: "API Keys für den Zugriff verwalten.",
    items: [
      {
        method: "GET",
        path: "/v1/api-keys",
        description: "Alle API Keys auflisten (ohne die Keys selbst)",
        response: `{ "ok": true, "apiKeys": [{ "id": "...", "name": "Clawbot", "is_active": true, "last_used_at": "..." }] }`,
      },
      {
        method: "POST",
        path: "/v1/api-keys",
        description: "Neuen API Key erstellen",
        body: `{ "name": "Mein Agent" }`,
        response: `{ "ok": true, "apiKey": { "id": "...", "name": "...", "key": "raw-key-only-shown-once" } }`,
        notes: "⚠️ Der Key wird nur EINMAL angezeigt! Danach ist nur noch der Hash gespeichert.",
      },
      {
        method: "PATCH",
        path: "/v1/api-keys/:id",
        description: "API Key aktivieren/deaktivieren",
        body: `{ "isActive": false }`,
        response: `{ "ok": true, "apiKey": { ... } }`,
      },
    ],
  },
];

const methodColors: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  POST: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  PATCH: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-1 rounded hover:bg-muted transition-colors"
      title="Kopieren"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
    </button>
  );
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false);
  const curlCmd = `curl -X ${ep.method} \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\${ep.body ? `
  -d '${ep.body.replace(/\n\s*/g, " ").trim()}' \\` : ""}
  ${BASE_URL}${ep.path}`;

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
      >
        <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${methodColors[ep.method]}`}>
          {ep.method}
        </span>
        <code className="text-sm font-mono text-foreground flex-1">{ep.path}</code>
        <span className="text-xs text-muted-foreground hidden sm:block max-w-[200px] truncate">{ep.description}</span>
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/40">
          <p className="text-sm text-muted-foreground">{ep.description}</p>

          {ep.params && (
            <div>
              <p className="text-xs font-semibold text-foreground mb-1">Query Parameter</p>
              <pre className="text-xs bg-muted/50 rounded-lg p-3 font-mono text-muted-foreground whitespace-pre-wrap">{ep.params}</pre>
            </div>
          )}

          {ep.body && (
            <div>
              <p className="text-xs font-semibold text-foreground mb-1">Request Body</p>
              <pre className="text-xs bg-muted/50 rounded-lg p-3 font-mono text-muted-foreground whitespace-pre-wrap">{ep.body}</pre>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-foreground mb-1">Response</p>
            <pre className="text-xs bg-muted/50 rounded-lg p-3 font-mono text-muted-foreground whitespace-pre-wrap">{ep.response}</pre>
          </div>

          {ep.notes && (
            <div className="text-xs text-muted-foreground bg-primary/5 border border-primary/10 rounded-lg p-3 whitespace-pre-wrap">
              💡 {ep.notes}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-foreground">curl Beispiel</p>
              <CopyButton text={curlCmd} />
            </div>
            <pre className="text-xs bg-muted/50 rounded-lg p-3 font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto">{curlCmd}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

const ApiDocsPage = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in max-w-4xl">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Book className="w-5 h-5 text-primary" />
            <h1 className="text-[28px] font-bold text-foreground tracking-tight">API Dokumentation</h1>
          </div>
          <p className="text-[15px] text-muted-foreground">
            REST API für externe Agenten (Clawbot, OpenClaw). Alle Endpunkte benötigen einen API Key als Bearer Token.
          </p>
        </div>

        {/* Auth info */}
        <div className="glass-card p-5 space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">Authentifizierung</h2>
          <p className="text-sm text-muted-foreground">
            Alle Requests (außer <code className="text-xs bg-muted px-1.5 py-0.5 rounded">/v1/health</code>) benötigen einen API Key.
            Zwei Methoden werden unterstützt:
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <pre className="text-xs bg-muted/50 rounded-lg px-3 py-2 font-mono text-foreground flex-1">
                X-API-Key: YOUR_API_KEY
              </pre>
              <CopyButton text="X-API-Key: YOUR_API_KEY" />
            </div>
            <p className="text-xs text-muted-foreground">oder</p>
            <div className="flex items-center gap-2">
              <pre className="text-xs bg-muted/50 rounded-lg px-3 py-2 font-mono text-foreground flex-1">
                Authorization: Bearer YOUR_API_KEY
              </pre>
              <CopyButton text="Authorization: Bearer YOUR_API_KEY" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="bg-muted/30 rounded-xl p-3">
              <p className="font-semibold text-foreground">Rate Limit</p>
              <p className="text-muted-foreground">60 Requests / Minute</p>
            </div>
            <div className="bg-muted/30 rounded-xl p-3">
              <p className="font-semibold text-foreground">Fehler-Codes</p>
              <p className="text-muted-foreground">401 / 403 / 404 / 422 / 429 / 500</p>
            </div>
            <div className="bg-muted/30 rounded-xl p-3">
              <p className="font-semibold text-foreground">Base URL</p>
              <p className="text-muted-foreground font-mono break-all">{BASE_URL}</p>
            </div>
          </div>
        </div>

        {/* Workflow */}
        <div className="glass-card p-5 space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">Workflow A: Produkt finden & listen</h2>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li><strong>Produkt suchen</strong> – <code className="text-xs bg-muted px-1 rounded">GET /v1/products/search?q=handwärmer</code></li>
            <li><strong>Details & Varianten abrufen</strong> – <code className="text-xs bg-muted px-1 rounded">GET /v1/products/:pid</code></li>
            <li><strong>Versandkosten prüfen</strong> – <code className="text-xs bg-muted px-1 rounded">POST /v1/products/freight</code> mit vid</li>
            <li><strong>Draft erstellen</strong> – <code className="text-xs bg-muted px-1 rounded">POST /v1/listings/prepare</code> mit cjVariantId</li>
            <li><strong>Auf eBay listen</strong> – <code className="text-xs bg-muted px-1 rounded">POST /v1/listings/publish</code> mit Preis & Titel</li>
            <li><strong>SKU Mapping anlegen</strong> – <code className="text-xs bg-muted px-1 rounded">POST /v1/sku-map</code> für Fulfillment-Verknüpfung</li>
          </ol>
          <h2 className="text-[15px] font-semibold text-foreground pt-3">Workflow B: Orders fulfillen</h2>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li><strong>Orders synchronisieren</strong> – <code className="text-xs bg-muted px-1 rounded">POST /v1/orders/sync</code></li>
            <li><strong>Offene Orders abrufen</strong> – <code className="text-xs bg-muted px-1 rounded">GET /v1/orders?status=awaiting_fulfillment</code></li>
            <li><strong>Order fulfillen</strong> – <code className="text-xs bg-muted px-1 rounded">POST /v1/orders/:id/fulfill</code> → CJ Order wird erstellt</li>
            <li><strong>Tracking synchronisieren</strong> – <code className="text-xs bg-muted px-1 rounded">POST /v1/orders/:id/sync-tracking</code> → Tracking wird an eBay gepusht</li>
          </ol>
        </div>

        {/* Endpoints */}
        {endpoints.map((section) => (
          <div key={section.section} className="space-y-3">
            <div>
              <h2 className="text-[17px] font-bold text-foreground">{section.section}</h2>
              <p className="text-sm text-muted-foreground">{section.description}</p>
            </div>
            <div className="space-y-2">
              {section.items.map((ep) => (
                <EndpointCard key={`${ep.method}-${ep.path}`} ep={ep} />
              ))}
            </div>
          </div>
        ))}

        {/* Error format */}
        <div className="glass-card p-5 space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">Fehler-Format</h2>
          <pre className="text-xs bg-muted/50 rounded-lg p-3 font-mono text-muted-foreground">{`{
  "ok": false,
  "error": "Beschreibung des Fehlers",
  "code": "UNAUTHORIZED | FORBIDDEN | NOT_FOUND | VALIDATION_ERROR | RATE_LIMITED"
}`}</pre>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ApiDocsPage;
