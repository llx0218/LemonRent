import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, Me } from "./api";
import { clearLoadCache } from "./components/ui";
import { setCurrency } from "./format";

interface AuthState {
  me: Me | null;
  loading: boolean;
  setMe: (m: Me | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>("/me");
      setCurrency(m.currency);
      setMe(m);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const out = () => {
      clearLoadCache();
      setMe(null);
    };
    window.addEventListener("lemonrent:signed-out", out);
    return () => window.removeEventListener("lemonrent:signed-out", out);
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      clearLoadCache();
      setMe(null);
    }
  }, []);

  useEffect(() => {
    if (me) setCurrency(me.currency);
  }, [me]);

  return <Ctx.Provider value={{ me, loading, setMe, refresh, logout }}>{children}</Ctx.Provider>;
}
