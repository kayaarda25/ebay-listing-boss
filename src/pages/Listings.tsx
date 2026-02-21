import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { mockListings } from "@/lib/mock-data";
import { Search, Filter, Plus, ExternalLink } from "lucide-react";
import { useState } from "react";

const ListingsPage = () => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = mockListings.filter((l) => {
    const matchSearch =
      l.sku.toLowerCase().includes(search.toLowerCase()) ||
      l.title.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || l.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Listings</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {mockListings.length} Listings · {mockListings.filter((l) => l.status === "active").length} aktiv
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity">
            <Plus className="w-4 h-4" />
            Import
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="SKU oder Titel suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-1 bg-card border border-border rounded-md p-0.5">
            {["all", "active", "paused", "error", "pending"].map((s) => (
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

        {/* Table */}
        <div className="glass-card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Titel</th>
                <th>Seller</th>
                <th>Status</th>
                <th>Preis</th>
                <th>Menge</th>
                <th>eBay ID</th>
                <th>Letzter Sync</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((listing) => (
                <tr key={listing.id}>
                  <td className="font-mono text-xs text-muted-foreground">{listing.sku}</td>
                  <td className="max-w-[250px] truncate">{listing.title}</td>
                  <td className="text-xs text-muted-foreground">{listing.seller}</td>
                  <td><StatusBadge status={listing.status} /></td>
                  <td className="font-mono">€{listing.price.toFixed(2)}</td>
                  <td className="font-mono">{listing.quantity}</td>
                  <td>
                    {listing.ebayListingId !== "-" ? (
                      <a
                        href={`https://www.ebay.de/itm/${listing.ebayListingId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-mono"
                      >
                        {listing.ebayListingId}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="text-xs text-muted-foreground">{listing.lastSynced}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Keine Listings gefunden.
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ListingsPage;
