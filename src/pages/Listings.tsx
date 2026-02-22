import { DashboardLayout } from "@/components/DashboardLayout";
import { CreateListingDialog } from "@/components/CreateListingDialog";
import { useAuth } from "@/hooks/useAuth";
import { fetchListings } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, ExternalLink, Loader2, Upload, Pause, RefreshCw, Pencil, Check, X, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ListingsPage = () => {
  const { sellerId } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPrice, setEditPrice] = useState("");

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ["listings", sellerId],
    queryFn: () => fetchListings(sellerId!),
    enabled: !!sellerId,
  });

  const filtered = listings.filter((l) => {
    const title = (l as any).title || "";
    const matchSearch =
      l.sku.toLowerCase().includes(search.toLowerCase()) ||
      title.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || l.state === statusFilter;
    return matchSearch && matchStatus;
  });

  async function handleSyncListings() {
    if (!sellerId) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("ebay-sync-listings", {
        body: { sellerId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Sync fehlgeschlagen");
      toast.success(data.message);
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Sync");
    } finally {
      setSyncing(false);
    }
  }

  async function handlePublish(offerId: string) {
    if (!sellerId) return;
    setActionId(offerId);
    try {
      const { data, error } = await supabase.functions.invoke("ebay-publish-offer", {
        body: { sellerId, offerId, action: "publish" },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Veröffentlichung fehlgeschlagen");
      toast.success(data.message);
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Veröffentlichen");
    } finally {
      setActionId(null);
    }
  }

  async function handleWithdraw(offerId: string) {
    if (!sellerId) return;
    setActionId(offerId);
    try {
      const { data, error } = await supabase.functions.invoke("ebay-publish-offer", {
        body: { sellerId, offerId, action: "withdraw" },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Zurückziehen fehlgeschlagen");
      toast.success(data.message);
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Zurückziehen");
    } finally {
      setActionId(null);
    }
  }

  function startEditing(listing: any) {
    setEditingId(listing.id);
    setEditTitle((listing as any).title || "");
    setEditPrice(String(listing.price ?? 0));
  }

  async function saveEdit(listingId: string) {
    try {
      const updateData: Record<string, any> = {};
      if (editTitle.trim()) updateData.title = editTitle.trim();
      const newPrice = parseFloat(editPrice);
      if (!isNaN(newPrice) && newPrice >= 0) updateData.price = newPrice;

      const { error } = await supabase
        .from("ebay_offers")
        .update(updateData)
        .eq("id", listingId);
      if (error) throw error;
      toast.success("Änderungen gespeichert");
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Speichern");
    } finally {
      setEditingId(null);
    }
  }

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
          <div className="flex items-center gap-3">
            <button
              onClick={handleSyncListings}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2.5 border border-border/60 text-foreground text-[14px] font-semibold rounded-xl hover:bg-muted transition-all duration-200 disabled:opacity-50"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              eBay Sync
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-[14px] font-semibold rounded-xl hover:bg-primary/90 transition-all duration-200 shadow-apple-sm"
            >
              <Plus className="w-4 h-4" />
              Listing erstellen
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Titel oder SKU suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border/60 rounded-xl text-[14px] text-foreground placeholder:text-muted-foreground transition-all duration-200"
            />
          </div>
          <div className="flex items-center gap-1 bg-card border border-border/60 rounded-xl p-1">
            {["all", "draft", "active", "published", "paused"].map((s) => (
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
              {listings.length === 0
                ? 'Noch keine Listings. Klicke "eBay Sync" um deine bestehenden Angebote zu importieren.'
                : "Keine Listings gefunden."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produkt</th>
                    <th>Status</th>
                    <th>Preis</th>
                    <th>Menge</th>
                    <th>Quelle</th>
                    <th>Letzter Sync</th>
                    <th className="text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => {
                    const title = (l as any).title || "";
                    const sourceUrl = (l as any).source_url || "";
                    const isEditing = editingId === l.id;

                    return (
                      <tr key={l.id}>
                        {/* Produkt */}
                        <td className="max-w-xs">
                          {isEditing ? (
                            <input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-border rounded-lg bg-background text-foreground"
                              autoFocus
                            />
                          ) : (
                            <div>
                              <p className="text-[14px] font-medium text-foreground truncate">
                                {title || <span className="text-muted-foreground italic">Kein Titel</span>}
                              </p>
                              <p className="text-xs font-mono text-muted-foreground">{l.sku}</p>
                            </div>
                          )}
                        </td>

                        {/* Status */}
                        <td>
                          <span
                            className={`status-badge ${
                              l.state === "active" || l.state === "published"
                                ? "status-active"
                                : l.state === "paused"
                                ? "status-paused"
                                : l.state === "error"
                                ? "status-error"
                                : "status-pending"
                            }`}
                          >
                            {l.state}
                          </span>
                        </td>

                        {/* Preis */}
                        <td>
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <span className="text-sm text-muted-foreground">€</span>
                              <input
                                value={editPrice}
                                onChange={(e) => setEditPrice(e.target.value)}
                                className="w-20 px-2 py-1 text-sm font-mono border border-border rounded-lg bg-background text-foreground"
                                type="number"
                                step="0.01"
                                min="0"
                              />
                            </div>
                          ) : (
                            <span className="font-mono text-[14px] font-semibold">
                              €{(l.price ?? 0).toFixed(2)}
                            </span>
                          )}
                        </td>

                        {/* Menge */}
                        <td className="font-mono text-[14px]">{l.quantity ?? 0}</td>

                        {/* Quelle */}
                        <td>
                          {l.listing_id ? (
                            <a
                              href={`https://www.ebay.de/itm/${l.listing_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:text-primary/80 inline-flex items-center gap-1 font-medium transition-colors"
                            >
                              eBay <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : sourceUrl ? (
                            <a
                              href={sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:text-primary/80 inline-flex items-center gap-1 font-medium transition-colors"
                            >
                              Amazon <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* Letzter Sync */}
                        <td className="text-xs text-muted-foreground">
                          {l.last_synced_at
                            ? new Date(l.last_synced_at).toLocaleString("de-DE")
                            : "—"}
                        </td>

                        {/* Aktionen */}
                        <td className="text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => saveEdit(l.id)}
                                className="p-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                                  <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44 rounded-xl">
                                <DropdownMenuItem onClick={() => startEditing(l)} className="rounded-lg">
                                  <Pencil className="w-3.5 h-3.5 mr-2" />
                                  Bearbeiten
                                </DropdownMenuItem>
                                {(l.state === "draft" || l.state === "paused") && (
                                  <DropdownMenuItem
                                    onClick={() => handlePublish(l.id)}
                                    disabled={actionId === l.id}
                                    className="rounded-lg text-primary"
                                  >
                                    {actionId === l.id ? (
                                      <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                                    ) : (
                                      <Upload className="w-3.5 h-3.5 mr-2" />
                                    )}
                                    Veröffentlichen
                                  </DropdownMenuItem>
                                )}
                                {(l.state === "published" || l.state === "active") && (
                                  <DropdownMenuItem
                                    onClick={() => handleWithdraw(l.id)}
                                    disabled={actionId === l.id}
                                    className="rounded-lg"
                                  >
                                    {actionId === l.id ? (
                                      <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                                    ) : (
                                      <Pause className="w-3.5 h-3.5 mr-2" />
                                    )}
                                    Zurückziehen
                                  </DropdownMenuItem>
                                )}
                                {l.listing_id && (
                                  <DropdownMenuItem asChild className="rounded-lg">
                                    <a
                                      href={`https://www.ebay.de/itm/${l.listing_id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5 mr-2" />
                                      Auf eBay ansehen
                                    </a>
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <CreateListingDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["listings"] })}
        />
      </div>
    </DashboardLayout>
  );
};

export default ListingsPage;
