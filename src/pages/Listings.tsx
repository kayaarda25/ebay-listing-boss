import { DashboardLayout } from "@/components/DashboardLayout";
import { CreateListingDialog } from "@/components/CreateListingDialog";
import { useAuth } from "@/hooks/useAuth";
import { fetchListings } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, ExternalLink } from "lucide-react";
import { useState } from "react";

const ListingsPage = () => {
  const { sellerId } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

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
            <h1 className="text-[28px] font-bold text-foreground tracking-tight">Listings</h1>
            <p className="text-[15px] text-muted-foreground mt-1">
              {listings.length} Listings gesamt
            </p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-[14px] font-semibold rounded-xl hover:bg-primary/90 transition-all duration-200 shadow-apple-sm"
          >
            <Plus className="w-4 h-4" />
            Listing erstellen
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="SKU suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border/60 rounded-xl text-[14px] text-foreground placeholder:text-muted-foreground transition-all duration-200"
            />
          </div>
          <div className="flex items-center gap-1 bg-card border border-border/60 rounded-xl p-1">
            {["all", "draft", "active", "published", "paused", "error"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                  statusFilter === s
                    ? "bg-primary text-primary-foreground shadow-apple-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "Alle" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="glass-card overflow-hidden">
          {isLoading ? (
            <div className="py-16 text-center text-[14px] text-muted-foreground">Laden...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-[14px] text-muted-foreground">
              {listings.length === 0 ? "Noch keine Listings. Importiere Produkte, um loszulegen." : "Keine Listings gefunden."}
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                          <a href={`https://www.ebay.de/itm/${l.listing_id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:text-primary/80 inline-flex items-center gap-1 font-mono font-medium transition-colors">
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
            </div>
          )}
        </div>
        <CreateListingDialog open={createOpen} onOpenChange={setCreateOpen} onSuccess={() => queryClient.invalidateQueries({ queryKey: ["listings"] })} />
      </div>
    </DashboardLayout>
  );
};

export default ListingsPage;
