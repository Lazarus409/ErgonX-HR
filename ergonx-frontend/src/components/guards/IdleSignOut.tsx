"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/guards/AuthProvider";
import { isRememberedSession } from "@/lib/api/client";

const LAST_ACTIVITY_KEY = "ergonx_last_activity";
const IDLE_MINUTES = Number(process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES) || 30;
const IDLE_MS = IDLE_MINUTES * 60 * 1000;
const WRITE_THROTTLE_MS = 15 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

function readLastActivity(): number {
  try {
    return Number(window.localStorage.getItem(LAST_ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Records user activity now; shared through localStorage so every open tab agrees. */
export function markActivity(): void {
  try {
    window.localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* Storage unavailable: the timer then relies on this tab's own events. */
  }
}

/**
 * Signs out a session that was not "kept signed in" after a period with no
 * keyboard, pointer or scroll activity in any tab. Remembered sessions are exempt.
 */
export default function IdleSignOut() {
  const { isLiveSession, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLiveSession || isRememberedSession()) return;

    let lastWrite = 0;
    let localLast = Date.now();
    const onActivity = () => {
      localLast = Date.now();
      if (localLast - lastWrite >= WRITE_THROTTLE_MS) {
        lastWrite = localLast;
        markActivity();
      }
    };
    const check = () => {
      const last = Math.max(readLastActivity(), lastWrite ? localLast : 0);
      if (last && Date.now() - last > IDLE_MS) {
        logout();
        router.replace("/login?reason=idle");
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };

    // A stale timestamp from before a restart or sleep ends the session straight away.
    if (readLastActivity() === 0) markActivity();
    check();

    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [isLiveSession, logout, router]);

  return null;
}

export { IDLE_MINUTES };
