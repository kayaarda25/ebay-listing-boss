import { DashboardLayout } from "@/components/DashboardLayout";
import { ImportDialog } from "@/components/ImportDialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, ExternalLink, Package } from "lucide-react";
import { useState } from "react";

async function fetchProducts(sellerId: string) {
  const { data } = await supabase
    .from("source_products")
    .select("*")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });
  return data || [];
}

const ProductsPage = () => {
  const { sellerId } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", sellerId],
    queryFn: () => fetchProducts(sellerId!),
    enabled: !!sellerId,
  });

  const filtered = products.filter((p) => {
    const term = search.toLowerCase();
    return (
      p.title.toLowerCase().includes(term) ||
      p.source_id.toLowerCase().includes(term)
    );
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-slide-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Produkte</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {products.length} importierte Quellprodukte
            </p>
          </div>
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Import
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Titel oder ASIN suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="glass-card overflow-x-auto">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Laden...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
              <Package className="w-10 h-10 text-muted-foreground/40" />
              {products.length === 0
                ? "Noch keine Produkte. Importiere Amazon-URLs, um loszulegen."
                : "Keine Produkte gefunden."}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Titel</th>
                  <th>ASIN</th>
                  <th>Quelle</th>
                  <th>Preis</th>
                  <th>Bestand</th>
                  <th>Amazon</th>
                  <th>Importiert am</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td className="max-w-[240px] truncate font-medium text-foreground">
                      {p.title}
                    </td>
                    <td className="font-mono text-xs text-muted-foreground">{p.source_id}</td>
                    <td>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-accent text-accent-foreground text-xs font-medium">
                        {p.source_type}
                      </span>
                    </td>
                    <td className="font-mono">
                      {p.price_source != null ? `€${Number(p.price_source).toFixed(2)}` : "—"}
                    </td>
                    <td className="font-mono">{p.stock_source ?? "—"}</td>
                    <td>
                      <a
                        href={`https://www.amazon.de/dp/${p.source_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-mono"
                      >
                        Öffnen <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleString("de-DE")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["products"] })}
        />
      </div>
    </DashboardLayout>
  );
};

export default ProductsPage;
