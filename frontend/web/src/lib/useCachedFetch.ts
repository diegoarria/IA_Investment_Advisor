import { useCallback, useEffect, useState } from "react";

// Fase 4, Incremento 13 (Cierre, Parte M — see /Users/diegoarria/.claude/
// plans/stateful-painting-flurry.md). Formalizes the stale-while-revalidate
// pattern this codebase already used ad hoc in two places —
// src/lib/useFxRate.ts (sync-read a cached value into initial state, fetch
// fresh, write back on success) and watchlist/page.tsx's readCache/
// writeCache (per-user-scoped localStorage key, never let an empty/failed
// response clobber a real cached value). useFxRate is refactored to sit on
// top of this hook (see below); watchlist's own cache was left as-is —
// its multi-source price-fallback logic is more involved than this hook's
// contract and not worth the regression risk of touching in a closing
// increment, but any NEW page needing this pattern should use this hook.

function readLocalStorage<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLocalStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full/unavailable — the in-memory state is still correct, only the cache write is skipped
  }
}

export interface UseCachedFetchOptions<T> {
  /** localStorage key — caller is responsible for scoping it (e.g. per-user). */
  key: string;
  fetcher: () => Promise<T>;
  /** Returning true means "don't trust this response enough to overwrite
   * the cache/state with it" — same guard watchlist/page.tsx's fetchWatchlist
   * already applies (`data.length > 0`) so a transient empty/error response
   * never clobbers a real cached value. Defaults to never treating a
   * response as empty. */
  isEmpty?: (data: T) => boolean;
  /** Skips fetching entirely (e.g. useFxRate skips for currency === "USD"). */
  enabled?: boolean;
  /** Optional periodic refetch, same "keep it fresh in the background"
   * behavior useFxRate already had (hourly). */
  refreshIntervalMs?: number;
}

export interface UseCachedFetchResult<T> {
  data: T | null;
  loading: boolean;
  /** Manually triggers a refetch (e.g. a pull-to-refresh button). */
  refresh: () => void;
}

export function useCachedFetch<T>({
  key, fetcher, isEmpty, enabled = true, refreshIntervalMs,
}: UseCachedFetchOptions<T>): UseCachedFetchResult<T> {
  const [data, setData] = useState<T | null>(() => readLocalStorage<T>(key));
  const [loading, setLoading] = useState(data === null);

  const load = useCallback(() => {
    if (!enabled) return;
    setLoading((prev) => prev && data === null);
    fetcher()
      .then((result) => {
        if (isEmpty?.(result)) return; // real failure/empty — keep whatever's already shown
        setData(result);
        writeLocalStorage(key, result);
      })
      .catch(() => {
        // network/API failure — the stale cached value (if any) stays on screen, never cleared
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => {
    load();
    if (!refreshIntervalMs || !enabled) return;
    const interval = setInterval(load, refreshIntervalMs);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, refreshIntervalMs]);

  return { data, loading, refresh: load };
}
