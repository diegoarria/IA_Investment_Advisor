import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { useTranslation } from "react-i18next";
import { screenerWeeklyApi } from "./api";
import type { WeeklyOpportunity } from "../components/WeeklyOpportunityCard";

// The one data path for the Screener Semanal on mobile (the Screener
// screen and the Portfolio card) — same rules as web's hook of the same
// name. Diego, 2026-09-27: "SIEMPRE debe mostrar las 5 opciones de la
// semana para cada usuario":
//  - the week's list is cached per user on-device and shown instantly,
//  - a request that fails is retried, and a failed/empty answer never
//    replaces a real list already on screen,
//  - `serverFree` flags the backend saying this account is Free (the
//    app's own tier can be optimistic) so callers show the Free teaser
//    instead of an empty Premium list.

export interface WeeklyData {
  results?: WeeklyOpportunity[];
  generated_at?: string | null;
}

// Diego, 2026-09-24: never persist an empty result, ignore one on read,
// and time-box every entry to 8 days so it can't outlive its week.
const WEEKLY_CACHE_KEY = "nuvos_weekly_screener_cache";
const WEEKLY_CACHE_MAX_AGE_MS = 8 * 24 * 3600 * 1000;
const RETRY_DELAYS_MS = [0, 1500, 4000, 8000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isValidWeeklyPayload(data: WeeklyData | null | undefined): data is WeeklyData {
  return !!data && (data.results?.length ?? 0) > 0;
}

async function cacheKey(): Promise<string> {
  const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
  return `${WEEKLY_CACHE_KEY}__${uid}`;
}

async function readWeeklyCache(): Promise<WeeklyData | null> {
  try {
    const raw = await AsyncStorage.getItem(await cacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > WEEKLY_CACHE_MAX_AGE_MS) return null;
    return isValidWeeklyPayload(parsed.data) ? parsed.data : null;
  } catch { return null; }
}

async function writeWeeklyCache(data: WeeklyData) {
  if (!isValidWeeklyPayload(data)) return;
  try {
    await AsyncStorage.setItem(await cacheKey(), JSON.stringify({ data, cachedAt: Date.now() }));
  } catch { /* best-effort — the session still has it in memory */ }
}

export function useWeeklyOpportunities(isPremium: boolean) {
  const { i18n } = useTranslation();
  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [serverFree, setServerFree] = useState(false);
  const loadSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    readWeeklyCache().then((cached) => {
      if (cached && !cancelled) setData((d) => (isValidWeeklyPayload(d) ? d : cached));
    });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    if (!isPremium) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setFailed(false);
    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await sleep(delay);
      if (seq !== loadSeq.current) return;
      try {
        const res: any = await screenerWeeklyApi.getWeeklyOpportunities(i18n.language, 25000);
        if (seq !== loadSeq.current) return;
        if (res.data?.is_premium === false) {
          setServerFree(true);
          setLoading(false);
          return;
        }
        setServerFree(false);
        if (isValidWeeklyPayload(res.data)) {
          setData(res.data);
          writeWeeklyCache(res.data);
          setLoading(false);
          return;
        }
        // An empty answer — try again rather than blanking the list.
      } catch {}
    }
    if (seq !== loadSeq.current) return;
    setFailed(true);
    setLoading(false);
  }, [isPremium, i18n.language]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, failed, serverFree, load };
}
