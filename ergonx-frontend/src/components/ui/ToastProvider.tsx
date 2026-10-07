"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cx } from "@/lib/cx";

type Toast = { id: number; title?: string; message: string; tone?: "success" | "error" | "info" };
type ToastContextValue = { showToast: (toast: Omit<Toast, "id">) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

const toneStyles = {
  success: { icon: CheckCircle2, iconClass: "text-success", bar: "bg-success", fallback: "Done" },
  error: { icon: XCircle, iconClass: "text-danger", bar: "bg-danger", fallback: "Action failed" },
  info: { icon: Info, iconClass: "text-primary", bar: "bg-primary", fallback: "Update" },
};

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { ...toast, id }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);
  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<Omit<Toast, "id">>).detail;
      if (detail?.message) showToast(detail);
    };
    window.addEventListener("ergonx:toast", handleToast);
    return () => window.removeEventListener("ergonx:toast", handleToast);
  }, [showToast]);
  const value = useMemo(() => ({ showToast }), [showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[200] flex w-[min(calc(100vw-2rem),24rem)] flex-col gap-3" aria-live="polite">
        {toasts.map((toast) => {
          const style = toneStyles[toast.tone ?? "info"];
          const Icon = style.icon;
          return (
            <div key={toast.id} role={toast.tone === "error" ? "alert" : "status"} className="pointer-events-auto relative flex animate-pop-in items-start gap-3 overflow-hidden rounded-2xl border border-line bg-surface p-4 pl-5 text-sm shadow-overlay">
              <span aria-hidden="true" className={cx("absolute inset-y-0 left-0 w-1", style.bar)} />
              <Icon className={cx("mt-0.5 h-5 w-5 shrink-0", style.iconClass)} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <strong className="block font-semibold text-ink-strong">{toast.title ?? style.fallback}</strong>
                <span className="mt-0.5 block text-support text-ink-muted">{toast.message}</span>
              </span>
              <button type="button" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} aria-label="Dismiss notification" className="-m-1 rounded-lg p-1 text-ink-subtle hover:bg-surface-hover hover:text-ink-strong">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
