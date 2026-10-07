"use client";

import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import { AdaptiveLogo } from "@/components/brand/Logo";
import { useTheme } from "@/components/context/ThemeProvider";
import { useAuth } from "@/components/guards/AuthProvider";

/**
 * Onboarding is a guided product moment that runs before the institution is
 * ready, so it uses the primary lockup and a quiet header instead of the full
 * application shell. Navigation and access rules are unchanged.
 */
export default function OnboardingFrame({ children }: { children: ReactNode }) {
  const { institution } = useAuth();
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-surface/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <AdaptiveLogo height={26} priority />
          <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
          <div className="hidden min-w-0 leading-tight sm:block">
            <p className="text-sm font-semibold text-ink-strong">Institution setup</p>
            <p className="truncate text-caption text-ink-muted">{institution?.name ?? "Your institution"}</p>
          </div>
          <div className="flex-1" />
          <button type="button" onClick={toggleTheme} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-strong" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>
      </header>
      <div className="px-4 pb-16 pt-8 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}
