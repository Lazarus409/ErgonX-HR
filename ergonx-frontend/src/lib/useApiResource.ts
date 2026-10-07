"use client";

import { useCallback, useEffect, useState } from "react";

import { getApiErrorMessage } from "@/lib/api";

export interface ApiResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Replace the loaded value after a local mutation, without refetching. */
  setData: (update: (current: T | null) => T | null) => void;
}

/**
 * Loads a single read-only API resource for a screen.
 *
 * Intended for dashboard-style reads. List screens that own pagination and
 * filter state should drive their own effect instead.
 *
 * `load` must be stable (wrap it in `useCallback` at the call site) or the
 * request will repeat on every render.
 */
export function useApiResource<T>(
  load: () => Promise<T>,
): ApiResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const result = await load();

        if (active) {
          setData(result);
        }
      } catch (caught) {
        if (active) {
          setError(getApiErrorMessage(caught));
          setData(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    run();

    return () => {
      active = false;
    };
  }, [load, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { data, loading, error, reload, setData };
}
