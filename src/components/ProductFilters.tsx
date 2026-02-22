import { useState } from "react";
import { Filter, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ProductFilterValues {
  sourceType: string;
  category: string;
  warehouse: string;
  hasStock: string;
}

const EMPTY_FILTERS: ProductFilterValues = {
  sourceType: "all",
  category: "all",
  warehouse: "all",
  hasStock: "all",
};

interface ProductFiltersProps {
  filters: ProductFilterValues;
  onFiltersChange: (filters: ProductFilterValues) => void;
  products: any[];
}

export function ProductFilters({ filters, onFiltersChange, products }: ProductFiltersProps) {
  const [expanded, setExpanded] = useState(false);

  // Extract unique values from products
  const categories = [...new Set(products.map((p) => getAttr(p, "category")).filter(Boolean))] as string[];
  const warehouses = [...new Set(products.map((p) => getAttr(p, "warehouse")).filter(Boolean))] as string[];
  const sourceTypes = [...new Set(products.map((p) => p.source_type).filter(Boolean))] as string[];

  const activeCount = Object.entries(filters).filter(([, v]) => v !== "all").length;

  function clearFilters() {
    onFiltersChange(EMPTY_FILTERS);
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <Filter className="w-4 h-4" />
        Filter
        {activeCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-semibold">
            {activeCount}
          </span>
        )}
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {expanded && (
        <div className="glass-card p-4 space-y-3 animate-slide-in">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Source Type */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Quelle</label>
              <Select value={filters.sourceType} onValueChange={(v) => onFiltersChange({ ...filters, sourceType: v })}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  {sourceTypes.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "amazon" ? "Amazon" : s === "cjdropshipping" ? "CJ Dropshipping" : s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Kategorie</label>
              <Select value={filters.category} onValueChange={(v) => onFiltersChange({ ...filters, category: v })}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Warehouse */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Lagerort</label>
              <Select value={filters.warehouse} onValueChange={(v) => onFiltersChange({ ...filters, warehouse: v })}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w} value={w}>{w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Stock */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Bestand</label>
              <Select value={filters.hasStock} onValueChange={(v) => onFiltersChange({ ...filters, hasStock: v })}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  <SelectItem value="instock">Auf Lager</SelectItem>
                  <SelectItem value="outofstock">Nicht verfügbar</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {activeCount > 0 && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs h-7 gap-1">
                <X className="w-3 h-3" />
                Filter zurücksetzen
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function applyProductFilters(products: any[], filters: ProductFilterValues): any[] {
  return products.filter((p) => {
    if (filters.sourceType !== "all" && p.source_type !== filters.sourceType) return false;
    if (filters.category !== "all" && getAttr(p, "category") !== filters.category) return false;
    if (filters.warehouse !== "all" && getAttr(p, "warehouse") !== filters.warehouse) return false;
    if (filters.hasStock === "instock" && (p.stock_source == null || p.stock_source <= 0)) return false;
    if (filters.hasStock === "outofstock" && p.stock_source != null && p.stock_source > 0) return false;
    return true;
  });
}

function getAttr(p: any, key: string) {
  if (p.attributes_json && typeof p.attributes_json === "object") {
    return (p.attributes_json as Record<string, any>)[key] ?? null;
  }
  return null;
}

export { EMPTY_FILTERS };
