"use client";

import { useEffect } from "react";

/** Registers only the static, tenant-data-free production PWA worker. */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // The application remains fully usable online if a browser blocks PWA registration.
    });
  }, []);

  return null;
}
