import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else navigate("/");
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setMessage("Bestätigungs-E-Mail gesendet. Bitte prüfe dein Postfach.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[380px] space-y-8 animate-slide-in">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-apple">
            <Zap className="w-7 h-7 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-[22px] font-bold text-foreground tracking-tight">SellerPilot</h1>
            <p className="text-[14px] text-muted-foreground mt-1">
              {isLogin ? "Willkommen zurück" : "Erstelle deinen Account"}
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4 glass-card p-5">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-2">E-Mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-[14px] text-foreground placeholder:text-muted-foreground transition-all duration-200"
                placeholder="name@beispiel.de"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-2">Passwort</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-[14px] text-foreground placeholder:text-muted-foreground transition-all duration-200"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error && <p className="text-[13px] text-destructive text-center">{error}</p>}
          {message && <p className="text-[13px] text-success text-center">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary text-primary-foreground text-[15px] font-semibold rounded-xl hover:bg-primary/90 transition-all duration-200 disabled:opacity-50 shadow-apple-sm"
          >
            {loading ? "Laden..." : isLogin ? "Anmelden" : "Registrieren"}
          </button>
        </form>

        <p className="text-center text-[13px] text-muted-foreground">
          {isLogin ? "Noch kein Account? " : "Bereits registriert? "}
          <button
            onClick={() => { setIsLogin(!isLogin); setError(""); setMessage(""); }}
            className="text-primary font-medium hover:text-primary/80 transition-colors"
          >
            {isLogin ? "Registrieren" : "Anmelden"}
          </button>
        </p>
      </div>
    </div>
  );
}
