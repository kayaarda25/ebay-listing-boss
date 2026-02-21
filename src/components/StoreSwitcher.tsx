import { useAuth } from "@/hooks/useAuth";
import { Store, ChevronDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function StoreSwitcher({ collapsed }: { collapsed: boolean }) {
  const { sellers, sellerId, switchSeller, createNewSeller } = useAuth();

  if (!sellers || sellers.length === 0) return null;

  const currentSeller = sellers.find((s) => s.id === sellerId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-muted transition-all duration-200 text-left">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Store className="w-3.5 h-3.5 text-primary" />
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">
                  {currentSeller?.ebay_user_id || `Shop ${sellers.indexOf(currentSeller!) + 1}`}
                </p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">
                  {currentSeller?.marketplace || "EBAY_DE"}
                </p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 rounded-xl">
        {sellers.map((s, i) => (
          <DropdownMenuItem
            key={s.id}
            onClick={() => switchSeller(s.id)}
            className={`rounded-lg ${s.id === sellerId ? "bg-primary/10 text-primary" : ""}`}
          >
            <Store className="w-3.5 h-3.5 mr-2" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {s.ebay_user_id || `Shop ${i + 1}`}
              </p>
              <p className="text-xs text-muted-foreground">{s.marketplace}</p>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={createNewSeller} className="rounded-lg text-primary">
          <Plus className="w-3.5 h-3.5 mr-2" />
          Neuen Shop hinzufügen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
