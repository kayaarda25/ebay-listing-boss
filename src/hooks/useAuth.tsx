import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { toast } from "sonner";

interface SellerInfo {
  id: string;
  ebay_user_id: string | null;
  marketplace: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  sellerId: string | null;
  sellers: SellerInfo[];
  switchSeller: (id: string) => void;
  createNewSeller: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  sellerId: null,
  sellers: [],
  switchSeller: () => {},
  createNewSeller: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [sellers, setSellers] = useState<SellerInfo[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchSellers(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchSellers(session.user.id);
      else {
        setSellerId(null);
        setSellers([]);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchSellers(userId: string) {
    const { data } = await supabase
      .from("sellers")
      .select("id, ebay_user_id, marketplace")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    
    const sellerList = (data || []) as SellerInfo[];
    setSellers(sellerList);
    
    // Restore last selected or pick first
    const stored = localStorage.getItem("active_seller_id");
    const match = sellerList.find(s => s.id === stored);
    setSellerId(match?.id ?? sellerList[0]?.id ?? null);
    setLoading(false);
  }

  function switchSeller(id: string) {
    setSellerId(id);
    localStorage.setItem("active_seller_id", id);
  }

  async function createNewSeller() {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("sellers")
        .insert({ user_id: user.id })
        .select("id, ebay_user_id, marketplace")
        .single();
      if (error) throw error;
      setSellers(prev => [...prev, data as SellerInfo]);
      setSellerId(data.id);
      localStorage.setItem("active_seller_id", data.id);
      toast.success("Neuer Shop erstellt");
    } catch (err: any) {
      toast.error(err.message || "Shop konnte nicht erstellt werden");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, sellerId, sellers, switchSeller, createNewSeller, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
