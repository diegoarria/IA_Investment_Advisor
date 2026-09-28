"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { screenerApi } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import type { WeeklyOpportunity } from "@/components/WeeklyOpportunityCard";

// The one data path for the Screener Semanal on web (the /screener page
// and the Portfolio card). Diego, 2026-09-27: "SIEMPRE debe mostrar las 5
// opciones de la semana para cada usuario" — the backend now always
// returns this week's 5 for a Premium user; this hook makes sure the
// screen never drops them:
//  - the week's list is cached per user and shown instantly,
//  - a request that fails is retried, and a failed/empty answer never
//    replaces a real list already on screen,
//  - `serverFree` flags the backend saying this account is Free (the app
//    optimistically assumes Premium until billing status loads) so callers
//    show the Free teaser instead of an empty Premium list.

export interface WeeklyData {
  results?: WeeklyOpportunity[];
  generated_at?: string | null;
}

// Cache entries are time-boxed to 8 days and an empty result is never
// persisted or read back (Diego, 2026-09-24).
const WEEKLY_CACHE_MAX_AGE_MS = 8 * 24 * 3600 * 1000;
const RETRY_DELAYS_MS = [0, 1500, 4000, 8000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function weeklyCacheKey(userId: string | null): string | null {
  return userId ? `nuvos_weekly_screener_cache__${userId}` : null;
}
function isValidWeeklyPayload(data: WeeklyData | null | undefined): data is WeeklyData {
  return !!data && (data.results?.length ?? 0) > 0;
}
function readWeeklyCache(userId: string | null): WeeklyData | null {
  const key = weeklyCacheKey(userId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: WeeklyData; cachedAt?: number };
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > WEEKLY_CACHE_MAX_AGE_MS) return null;
    return isValidWeeklyPayload(parsed.data) ? parsed.data! : null;
  } catch { return null; }
}
function writeWeeklyCache(userId: string | null, data: WeeklyData) {
  const key = weeklyCacheKey(userId);
  if (!key || !isValidWeeklyPayload(data)) return;
  try { localStorage.setItem(key, JSON.stringify({ data, cachedAt: Date.now() })); } catch {}
}

export function useWeeklyOpportunities(isPremium: boolean) {
  const { i18n } = useTranslation();
  const { isAuthenticated, authRestoring, userId } = useAuthStore();
  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [serverFree, setServerFree] = useState(false);
  const loadSeq = useRef(0);

  useEffect(() => {
    const cached = readWeeklyCache(userId);
    if (cached) setData((d) => (isValidWeeklyPayload(d) ? d : cached));
  }, [userId]);

  const load = useCallback(async () => {
    // Firing before the session cookie is attached used to 401 — wait for auth.
    if (authRestoring || !isAuthenticated || !isPremium) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setFailed(false);
    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await sleep(delay);
      if (seq !== loadSeq.current) return;
      try {
        const res = await screenerApi.getWeeklyOpportunities(i18n.language);
        if (seq !== loadSeq.current) return;
        const payload = res.data as WeeklyData & { is_premium?: boolean };
        if (payload?.is_premium === false) {
          setServerFree(true);
          setLoading(false);
          return;
        }
        setServerFree(false);
        if (isValidWeeklyPayload(payload)) {
          setData(payload);
          writeWeeklyCache(userId, payload);
          setLoading(false);
          return;
        }
        // An empty answer — try again rather than blanking the list.
      } catch {}
    }
    if (seq !== loadSeq.current) return;
    setFailed(true);
    setLoading(false);
  }, [isPremium, authRestoring, isAuthenticated, userId, i18n.language]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, failed, serverFree, load };
}
