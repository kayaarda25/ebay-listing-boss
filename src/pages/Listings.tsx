import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { fetchListings } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, ExternalLink } from "lucide-react";
import { useState } from "react";

const ListingsPage = () => {
  const { sellerId } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ["listings", sellerId],
    queryFn: () => fetchListings(sellerId!),
    enabled: !!sellerId,
  });

  const filtered = listings.filter((l) => {
    const matchSearch = l.sku.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || l.state === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Listings</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {listings.length} Listings gesamt
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity">
            <Plus className="w-4 h-4" />
            Import
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="SKU suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-1 bg-card border border-border rounded-md p-0.5">
            {["all", "draft", "active", "published", "paused", "error"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "Alle" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="glass-card overflow-x-auto">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Laden...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {listings.length === 0 ? "Noch keine Listings. Importiere Produkte, um loszulegen." : "Keine Listings gefunden."}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Status</th>
                  <th>Preis</th>
                  <th>Menge</th>
                  <th>Offer ID</th>
                  <th>eBay Listing</th>
                  <th>Letzter Sync</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id}>
                    <td className="font-mono text-xs text-muted-foreground">{l.sku}</td>
                    <td>
                      <span className={`status-badge ${l.state === 'active' || l.state === 'published' ? 'status-active' : l.state === 'paused' ? 'status-paused' : l.state === 'error' ? 'status-error' : 'status-pending'}`}>
                        {l.state}
                      </span>
                    </td>
                    <td className="font-mono">€{(l.price ?? 0).toFixed(2)}</td>
                    <td className="font-mono">{l.quantity ?? 0}</td>
                    <td className="font-mono text-xs text-muted-foreground">{l.offer_id || "—"}</td>
                    <td>
                      {l.listing_id ? (
                        <a href={`https://www.ebay.de/itm/${l.listing_id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-mono">
                          {l.listing_id} <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {l.last_synced_at ? new Date(l.last_synced_at).toLocaleString("de-DE") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ListingsPage;
