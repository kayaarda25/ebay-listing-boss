import { useState } from "react";
import { Key, Plus, Copy, Check, Loader2, ShieldOff, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ApiKeyItem {
  id: string;
  name: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export function ApiKeyManager({ sellerId }: { sellerId: string }) {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadKeys() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("api", {
        method: "GET",
        headers: { "x-api-path": "/v1/api-keys" },
      });
      // Since we can't easily call with custom path, let's query the DB directly
      // The api_keys table has RLS "false" so we need service role.
      // Instead, let's use a dedicated edge function or query via the API.
      // For now, query directly (the API gateway handles it).
    } catch {}
    setLoading(false);
  }

  async function fetchKeys() {
    setLoading(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/api-keys-manage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ action: "list", sellerId }),
        }
      );
      const data = await res.json();
      if (data.ok) {
        setKeys(data.apiKeys || []);
        setLoaded(true);
      } else {
        toast.error(data.error || "Fehler beim Laden");
      }
    } catch (err: any) {
      toast.error(err.message || "Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function createKey() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/api-keys-manage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ action: "create", sellerId, name: newKeyName.trim() }),
        }
      );
      const data = await res.json();
      if (data.ok) {
        setRevealedKey(data.apiKey.key);
        setNewKeyName("");
        toast.success("API Key erstellt! Kopiere ihn jetzt – er wird nicht erneut angezeigt.");
        fetchKeys();
      } else {
        toast.error(data.error || "Fehler beim Erstellen");
      }
    } catch (err: any) {
      toast.error(err.message || "Fehler");
    } finally {
      setCreating(false);
    }
  }

  async function toggleKey(id: string, isActive: boolean) {
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/api-keys-manage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ action: "toggle", sellerId, keyId: id, isActive: !isActive }),
        }
      );
      const data = await res.json();
      if (data.ok) {
        toast.success(isActive ? "Key deaktiviert" : "Key aktiviert");
        fetchKeys();
      }
    } catch (err: any) {
      toast.error(err.message || "Fehler");
    }
  }

  function copyKey() {
    if (revealedKey) {
      navigator.clipboard.writeText(revealedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-primary" />
          <h2 className="text-[15px] font-semibold text-foreground">API Keys</h2>
        </div>
        {!loaded && (
          <Button variant="outline" size="sm" className="rounded-xl" onClick={fetchKeys} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Keys laden"}
          </Button>
        )}
      </div>

      <div className="px-5 py-4 space-y-4">
        <p className="text-[13px] text-muted-foreground">
          API Keys ermöglichen externen Agenten (z.B. Clawbot) den Zugriff auf die REST API.
          Nutze <span className="font-mono text-xs">Authorization: Bearer &lt;key&gt;</span> im Header.
        </p>

        {/* Revealed key banner */}
        {revealedKey && (
          <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl space-y-2">
            <p className="text-xs font-semibold text-primary">⚠️ Neuer API Key – jetzt kopieren!</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-background/80 px-3 py-2 rounded-lg break-all text-foreground">
                {revealedKey}
              </code>
              <Button size="sm" variant="outline" className="rounded-xl shrink-0" onClick={copyKey}>
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setRevealedKey(null)}>
              Schließen
            </Button>
          </div>
        )}

        {/* Create new key */}
        {loaded && (
          <div className="flex items-center gap-2">
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key-Name (z.B. Clawbot Prod)"
              className="rounded-xl"
              onKeyDown={(e) => e.key === "Enter" && createKey()}
            />
            <Button onClick={createKey} disabled={!newKeyName.trim() || creating} className="rounded-xl shrink-0">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Erstellen
            </Button>
          </div>
        )}

        {/* Key list */}
        {loaded && keys.length > 0 && (
          <div className="space-y-2">
            {keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between px-4 py-3 bg-muted/50 rounded-xl"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${k.is_active ? "bg-success" : "bg-muted-foreground"}`} />
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-foreground truncate">{k.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Erstellt: {new Date(k.created_at).toLocaleDateString("de")}
                      {k.last_used_at && ` · Zuletzt: ${new Date(k.last_used_at).toLocaleDateString("de")}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 rounded-xl"
                  onClick={() => toggleKey(k.id, k.is_active)}
                >
                  {k.is_active ? (
                    <><ShieldOff className="w-4 h-4 mr-1" /> Deaktivieren</>
                  ) : (
                    <><Shield className="w-4 h-4 mr-1" /> Aktivieren</>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}

        {loaded && keys.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Noch keine API Keys erstellt.</p>
        )}
      </div>
    </div>
  );
}
