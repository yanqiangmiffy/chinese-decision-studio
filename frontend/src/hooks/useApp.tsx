import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import type { Health } from "../types";

type ToastKind = "ok" | "bad" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface AppState {
  health: Health | null;
  refreshHealth: () => void;
  toast: (text: string, kind?: ToastKind) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (document.documentElement.dataset.theme as "dark" | "light") || "dark",
  );
  const [collapsed, setCollapsedState] = useState(() => localStorage.getItem("ds-collapsed") === "1");
  const seq = useRef(0);

  const refreshHealth = useCallback(() => {
    api
      .health()
      .then(setHealth)
      .catch(() =>
        setHealth((h) => (h ? { ...h, status: "down", decision: { ...h.decision, online: false } } : null)),
      );
  }, []);

  useEffect(() => {
    refreshHealth();
    const t = window.setInterval(refreshHealth, 10000);
    return () => window.clearInterval(t);
  }, [refreshHealth]);

  const toast = useCallback((text: string, kind: ToastKind = "info") => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "bad" ? 6000 : 3500);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("ds-theme", next);
      return next;
    });
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    localStorage.setItem("ds-collapsed", v ? "1" : "0");
  }, []);

  const value = useMemo(
    () => ({ health, refreshHealth, toast, theme, toggleTheme, collapsed, setCollapsed }),
    [health, refreshHealth, toast, theme, toggleTheme, collapsed, setCollapsed],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "ok" ? <CheckCircle2 /> : t.kind === "bad" ? <AlertCircle /> : <Info />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
