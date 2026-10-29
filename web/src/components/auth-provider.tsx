"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { api } from "@/services/api";

export type User = {
  id: string;
  email: string;
  display_name: string;
  created_at: number;
  has_avatar: boolean;
};
type AuthState = {
  user: User | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
};
const Context = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, writeUser] = useState<User | null>(null);
  const generation = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const setUser = useCallback((value: User | null) => {
    ++generation.current;
    writeUser(value);
    setError("");
    setLoading(false);
  }, []);
  const refresh = useCallback(async () => {
    const requestId = ++generation.current;
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (requestId !== generation.current) return;
      if (response.status === 401) {
        writeUser(null);
        setError("");
        return;
      }
      if (!response.ok)
        throw new Error("Account services are currently unavailable.");
      const data = await response.json();
      if (requestId !== generation.current) return;
      writeUser(data.user);
      setError("");
    } catch {
      // A network outage is not a sign-out; retain the active account's cache.
      if (requestId === generation.current)
        setError("Account services are currently unavailable.");
    } finally {
      if (requestId === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const recheck = () => {
      refresh();
    };
    window.addEventListener("focus", recheck);
    window.addEventListener("online", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
    };
  }, [refresh]);
  return (
    <Context.Provider value={{ user, loading, error, refresh, setUser }}>
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error("AuthProvider is missing");
  return context;
}
export function AccountMenu() {
  const { user, loading, setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (loading)
    return (
      <span className="account-menu" role="status">
        Opening account…
      </span>
    );
  return (
    <div className="account-menu">
      {user ? (
        <>
          <Link href="/profile">{user.display_name} · My profile</Link>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("auth/logout", {});
                setUser(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not sign out");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </>
      ) : (
        <>
          <Link href="/login">Sign in</Link>
          <Link href="/signup">Create account</Link>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
